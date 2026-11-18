import { createRoot } from 'react-dom/client';
import { SharePreviewDialog } from '../src/components/SharePreviewDialog.js';
import '../src/index.css';

/**
 * A one-dialog page for the layout spec. It mounts the real component with the
 * real stylesheet, so the measurements are the app's, not a mock's. The photo
 * URL comes from the query string; the spec serves it from a generated JPEG.
 */
const params = new URLSearchParams(location.search);

createRoot(document.getElementById('root') as HTMLElement).render(
  <SharePreviewDialog
    open
    onOpenChange={() => undefined}
    card={{
      photoUrl: params.get('photo'),
      title: params.get('title') ?? 'Chicken rice bowl',
      calories: 512,
      proteinG: 32,
      carbsG: 61,
      fatG: 14,
    }}
    sharing={false}
    onShare={() => undefined}
  />,
);
