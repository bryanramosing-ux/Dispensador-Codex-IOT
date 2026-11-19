import { galleryObject } from '@/lib/server/camera';
import { HttpError, jpeg, json, operator } from '@/lib/server/http';

type Context = { params: Promise<{ name: string }> };

export function GET(request: Request, context: Context) {
  return operator(request, async () => {
    const { name } = await context.params;
    const { file } = await galleryObject(name);
    try {
      const [buffer] = await file.download({ validation: false });
      return jpeg(buffer, name, new URL(request.url).searchParams.get('download') === '1');
    } catch (error) {
      if (Number((error as { code?: unknown }).code) === 404) throw new HttpError(404, 'No se encontró la imagen.');
      throw error;
    }
  });
}

export function DELETE(request: Request, context: Context) {
  return operator(request, async () => {
    if (request.headers.get('x-confirm') !== 'delete') throw new HttpError(400, 'Confirma el borrado de la foto.');
    const { name } = await context.params;
    const { file, ref } = await galleryObject(name);
    await file.delete({ ignoreNotFound: true });
    await ref.delete();
    return json({ ok: true });
  });
}
