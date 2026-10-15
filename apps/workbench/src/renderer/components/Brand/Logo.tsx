import { HulalaLogo } from '../Icons';

interface LogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export function Logo({ className = '', width = 24, height = 24 }: LogoProps) {
  return <HulalaLogo className={className} width={width} height={height} />;
}
