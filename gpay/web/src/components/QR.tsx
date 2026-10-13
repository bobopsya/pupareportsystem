import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { cx } from './ui';

/** QR code rendered as inline SVG markup produced by the qrcode library from our own text. */
export function QR({ text, className, dark = '#0b0b14' }: { text: string; className?: string; dark?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark, light: '#ffffff00' } }).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [text, dark]);
  return <div className={cx('[&>svg]:w-full [&>svg]:h-full', className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
