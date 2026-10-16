import React from 'react';

export type IconButtonVariant = 'toolbar' | 'inline';

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: number;
  variant?: IconButtonVariant;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className = '', size, style, type, variant = 'toolbar', ...props }, ref) => {
    const buttonStyle = size == null
      ? style
      : {
          ...style,
          width: size,
          minWidth: size,
          height: size,
        };

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        data-icon-button-variant={variant}
        className={`icon-gutter-btn-sm ${variant === 'inline' ? 'icon-button-inline' : 'icon-button-toolbar'} ${className}`.trim()}
        style={buttonStyle}
        {...props}
      />
    );
  }
);

IconButton.displayName = 'IconButton';
