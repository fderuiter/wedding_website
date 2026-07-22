import React from 'react';

export type IconName =
  | 'X'
  | 'Loader2'
  | 'Camera'
  | 'Users'
  | 'Map'
  | 'Cloud'
  | 'MapPin'
  | 'Globe'
  | 'Eye'
  | 'EyeOff'
  | 'ArrowLeft'
  | 'ExternalLink'
  | 'ArrowUp'
  | 'ChevronDown'
  | 'SearchX'
  | 'Sun'
  | 'CloudRain'
  | 'CloudSnow'
  | 'Wind'
  | 'Droplets'
  | 'Thermometer'
  | 'ChevronLeft'
  | 'ChevronRight'
  | 'Menu'
  | 'DragHandle'
  | 'Spinner';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number | string;
}

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(({ name, size, width, height, className = '', ...props }, ref) => {
  const commonProps = {
    ref,
    xmlns: 'http://www.w3.org/2000/svg',
    width: size ?? width ?? '24',
    height: size ?? height ?? '24',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    ...props
  };

  switch (name) {
    case 'X':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case 'Loader2':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case 'Camera':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      );
    case 'Users':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <path d="M16 3.128a4 4 0 0 1 0 7.744" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <circle cx="9" cy="7" r="4" />
        </svg>
      );
    case 'Map':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
          <path d="M15 5.764v15" />
          <path d="M9 3.236v15" />
        </svg>
      );
    case 'Cloud':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      );
    case 'MapPin':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case 'Globe':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
      );
    case 'Eye':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'EyeOff':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
          <path d="m2 2 20 20" />
        </svg>
      );
    case 'ArrowLeft':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      );
    case 'ExternalLink':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      );
    case 'ArrowUp':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      );
    case 'ChevronDown':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'SearchX':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m13.5 8.5-5 5" />
          <path d="m8.5 8.5 5 5" />
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case 'Sun':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      );
    case 'CloudRain':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
          <path d="M16 14v6" />
          <path d="M8 14v6" />
          <path d="M12 16v6" />
        </svg>
      );
    case 'CloudSnow':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
          <path d="M8 15h.01" />
          <path d="M8 19h.01" />
          <path d="M12 17h.01" />
          <path d="M12 21h.01" />
          <path d="M16 15h.01" />
          <path d="M16 19h.01" />
        </svg>
      );
    case 'Wind':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
          <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
          <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
        </svg>
      );
    case 'Droplets':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
          <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
        </svg>
      );
    case 'Thermometer':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
        </svg>
      );
    case 'ChevronLeft':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case 'ChevronRight':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case 'Menu':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case 'DragHandle':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <path d="M4 8h16M4 16h16" />
        </svg>
      );
    case 'Spinner':
      return (
        <svg {...(commonProps as React.SVGProps<SVGSVGElement>)}>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      );
    default:
      return null;
  }
});

Icon.displayName = 'Icon';
