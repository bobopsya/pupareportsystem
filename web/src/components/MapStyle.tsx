import { Moon, Sun, SunMoon } from 'lucide-react';
import { useMapStyle } from '../lib/theme';
import { Segmented } from './ui';

/** Map tile style switch, shared by every map (the choice is remembered). */
export function MapStyleToggle() {
  const { style, setStyle } = useMapStyle();
  return (
    <Segmented
      value={style}
      onChange={setStyle}
      options={[
        { id: 'auto', label: <SunMoon className="size-3.5" />, title: 'Карта: как тема портала' },
        { id: 'dark', label: <Moon className="size-3.5" />, title: 'Карта: тёмная' },
        { id: 'light', label: <Sun className="size-3.5" />, title: 'Карта: светлая' },
      ]}
    />
  );
}
