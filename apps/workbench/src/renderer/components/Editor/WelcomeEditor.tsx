import React from 'react';
import { BrandMark } from '../Brand/BrandMark';

export const WelcomeEditor: React.FC = () => (
  <div className="relative flex-1">
    <div className="hulala-welcome-brand-mark absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
      <BrandMark appearance="welcome" />
    </div>
  </div>
);
