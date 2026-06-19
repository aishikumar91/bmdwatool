import { APP_NAME, LOGO_ALT, LOGO_SRC } from '../constants/brand';
import './AppLogo.css';

type AppLogoVariant = 'sidebar' | 'sidebar-collapsed' | 'mobile' | 'login';

interface AppLogoProps {
  variant?: AppLogoVariant;
  className?: string;
}

export function AppLogo({ variant = 'sidebar', className = '' }: AppLogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt={LOGO_ALT}
      className={`app-logo app-logo--${variant} ${className}`.trim()}
      draggable={false}
    />
  );
}

export { APP_NAME, LOGO_ALT, LOGO_SRC };
