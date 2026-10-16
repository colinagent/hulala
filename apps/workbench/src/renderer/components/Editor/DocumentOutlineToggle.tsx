import React from 'react';

type DocumentOutlineToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

export const DocumentOutlineToggle: React.FC<DocumentOutlineToggleProps> = ({
  expanded,
  onToggle,
}) => {
  const label = expanded ? 'Collapse outline' : 'Expand outline';

  return (
    <button
      type="button"
      className={`op-document-outline-toggle icon-gutter-btn-sm icon-button-inline ${expanded ? 'is-active' : ''}`}
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={expanded}
    >
      {expanded ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="op-md-outline-collapse-icon"
          aria-hidden="true"
        >
          <path
            d="M12.5 4L8.5 8L12.5 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 4L3.5 8L7.5 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="op-md-outline-hamburger-icon"
          aria-hidden="true"
        >
          <path
            d="M3 4H13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 8H13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 12H9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
};
