import { createConnection } from 'node:net';
import { MAX_PHOTO } from '../devices/edge-http';

const boundary = '--esp32cam';
export const MJPEG_TYPE = 'multipart/x-mixed-replace; boundary=esp32cam';

export async function* upstreamFrames(base: string, signal: AbortSignal) {
  const url = new URL(base);
  // Arduino WebServer 2.x/3.x anuncia Content-Length: 0 antes de escribir las partes.
  const socket = createConnection({ host: url.hostname, port: Number(url.port || 80), signal });
  const deadline = setTimeout(() => socket.destroy(new Error('tiempo límite de MJPEG')), 8000);
  socket.setTimeout(5000, () => socket.destroy(new Error('cámara sin respuesta')));
  let buffer = Buffer.alloc(0);
  let responseRead = false;
  let jpegLength = 0;
  socket.once('connect', () =>
    socket.write('GET /stream HTTP/1.0\r\nHost: ' + url.host + '\r\nConnection: close\r\n\r\n'),
  );
  try {
    for await (const chunk of socket) {
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      while (buffer.length) {
        if (!jpegLength) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end < 0) {
            if (buffer.length > 8192) throw new Error('cabecera MJPEG demasiado grande');
            break;
          }
          if (end > 8192) throw new Error('cabecera MJPEG demasiado grande');
          const header = buffer.toString('latin1', 0, end).trimStart();
          buffer = buffer.subarray(end + 4);
          if (!responseRead) {
            if (
              !/^HTTP\/1\.[01] 200\b/.test(header) ||
              !/\r\ncontent-type:\s*multipart\/x-mixed-replace;\s*boundary="?esp32cam"?(?:\r\n|$)/i.test(
                header,
              ) ||
              /\r\ntransfer-encoding:/i.test(header)
            )
              throw new Error('respuesta MJPEG inválida');
            responseRead = true;
            continue;
          }
          if (
            !header.startsWith(boundary + '\r\n') ||
            !/\r\ncontent-type:\s*image\/jpeg(?:\r\n|$)/i.test(header)
          ) {
            throw new Error('parte MJPEG inválida');
          }
          jpegLength = Number(/\r\ncontent-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header)?.[1]);
          if (!(jpegLength >= 2 && jpegLength <= MAX_PHOTO)) throw new Error('longitud MJPEG inválida');
        }
        if (buffer.length < jpegLength) break;
        const jpeg = buffer.subarray(0, jpegLength);
        buffer = buffer.subarray(jpegLength);
        jpegLength = 0;
        if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('JPEG inválido');
        yield Buffer.concat([
          Buffer.from(
            boundary + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.length + '\r\n\r\n',
          ),
          jpeg,
          Buffer.from('\r\n'),
        ]);
      }
    }
  } finally {
    clearTimeout(deadline);
    socket.destroy();
  }
}
