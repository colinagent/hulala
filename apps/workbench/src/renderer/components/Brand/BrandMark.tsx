import { HulalaLogo } from '../Icons';

const PRODUCT_NAME = 'HULALA';
const PRODUCT_DOMAIN_SUFFIX = '.ai';
const PRODUCT_NAME_ZH = '呼啦啦';

type BrandMarkProps = {
  appearance?: 'default' | 'welcome';
};

export function BrandMark({ appearance = 'default' }: BrandMarkProps) {
  const isWelcome = appearance === 'welcome';
  const logoClassName = 'block h-32 w-32 shrink-0';

  return (
    <div className={`hulala-brand-mark${isWelcome ? ' hulala-brand-mark-welcome' : ''} flex flex-col items-center gap-5`}>
      <HulalaLogo
        className={logoClassName}
        title="Hulala"
      />
      <div className="flex items-baseline gap-1">
        <h1 className="hulala-brand-name-latin m-0 text-center text-2xl">
          {PRODUCT_NAME}
          <span className="hulala-brand-name-domain">{PRODUCT_DOMAIN_SUFFIX}</span>
        </h1>
        <p className="hulala-brand-name-zh m-0 whitespace-nowrap text-center text-base leading-snug">
          {PRODUCT_NAME_ZH}
        </p>
      </div>
    </div>
  );
}
