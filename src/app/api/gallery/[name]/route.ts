import { deletePhoto, galleryBytes } from '@/lib/server/camera';
import { HttpError, jpeg, json, operator } from '@/lib/server/http';

type Context = { params: Promise<{ name: string }> };

export function GET(request: Request, context: Context) {
  return operator(request, async () => {
    const { name } = await context.params;
    return jpeg(await galleryBytes(name), name, new URL(request.url).searchParams.get('download') === '1');
  });
}

export function DELETE(request: Request, context: Context) {
  return operator(request, async () => {
    if (request.headers.get('x-confirm') !== 'delete') throw new HttpError(400, 'Confirma el borrado de la foto.');
    await deletePhoto((await context.params).name);
    return json({ ok: true });
  });
}
