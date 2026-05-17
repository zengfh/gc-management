import { useEffect, useState } from 'react';
import { barcodeSvgDataUri } from './credentialHelpers';

export function BarcodePreview({ value, format }: { value?: string | null; format?: string | null }) {
  const barcodeKey = `${format || 'code128'}:${value || ''}`;
  const [barcodeImage, setBarcodeImage] = useState<{ key: string; src: string | null }>({ key: '', src: null });

  useEffect(() => {
    let canceled = false;
    if (!value) {
      return undefined;
    }

    import('bwip-js')
      .then((module) => {
        if (!canceled) {
          setBarcodeImage({
            key: barcodeKey,
            src: barcodeSvgDataUri(value, format, module.toSVG),
          });
        }
      })
      .catch(() => {
        if (!canceled) {
          setBarcodeImage({ key: barcodeKey, src: null });
        }
      });

    return () => {
      canceled = true;
    };
  }, [barcodeKey, format, value]);

  const src = barcodeImage.key === barcodeKey ? barcodeImage.src : null;

  if (!value || !src) {
    return null;
  }

  return (
    <div className="barcode-preview" aria-label="Scannable barcode">
      <img src={src} alt="Scannable barcode" />
    </div>
  );
}
