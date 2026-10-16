const LIGHT = 1;
const DARK = 3;

const O = [
  [0, LIGHT, LIGHT, LIGHT, 0],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [0, LIGHT, LIGHT, LIGHT, 0],
];

const P = [
  [LIGHT, LIGHT, LIGHT, LIGHT, 0],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, LIGHT, LIGHT, 0],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, 0, 0, 0],
];

const E_LIGHT = [
  [LIGHT, LIGHT, LIGHT, LIGHT, LIGHT],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, LIGHT, LIGHT, 0],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, 0, 0, 0],
  [LIGHT, LIGHT, LIGHT, LIGHT, LIGHT],
];

const N_LIGHT = [
  [LIGHT, LIGHT, 0, LIGHT, LIGHT],
  [LIGHT, LIGHT, LIGHT, 0, LIGHT],
  [LIGHT, 0, LIGHT, 0, LIGHT],
  [LIGHT, 0, 0, LIGHT, LIGHT],
  [LIGHT, 0, 0, LIGHT, LIGHT],
  [LIGHT, 0, 0, LIGHT, LIGHT],
  [LIGHT, 0, 0, LIGHT, LIGHT],
];

const B = [
  [DARK, DARK, DARK, DARK, 0],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, DARK, DARK, 0],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, DARK, DARK, 0],
];

const R = [
  [DARK, DARK, DARK, DARK, 0],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, DARK, DARK, 0],
  [DARK, DARK, DARK, 0, 0],
  [DARK, DARK, 0, DARK, 0],
  [DARK, DARK, 0, 0, DARK],
];

const A = [
  [0, DARK, DARK, DARK, 0],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, DARK, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, 0, DARK, DARK],
];

const I = [
  [DARK, DARK, DARK, DARK, DARK],
  [0, 0, DARK, 0, 0],
  [0, 0, DARK, 0, 0],
  [0, 0, DARK, 0, 0],
  [0, 0, DARK, 0, 0],
  [0, 0, DARK, 0, 0],
  [DARK, DARK, DARK, DARK, DARK],
];

const N_DARK = [
  [DARK, DARK, 0, DARK, DARK],
  [DARK, DARK, DARK, 0, DARK],
  [DARK, 0, DARK, 0, DARK],
  [DARK, 0, 0, DARK, DARK],
  [DARK, 0, 0, DARK, DARK],
  [DARK, 0, 0, DARK, DARK],
  [DARK, 0, 0, DARK, DARK],
];

const WORD_GROUPS = [
  [O, P, E_LIGHT, N_LIGHT],
  [B, R, A, I, N_DARK],
];

const LETTER_WIDTH = 5;
const LETTER_HEIGHT = 7;

type PixelLogoProps = {
  pixelSize?: number;
  pixelGap?: number;
  letterSpacing?: number;
  wordGap?: number;
};

function getColor(value: number) {
  switch (value) {
    case LIGHT:
      return 'var(--color-logo-light)';
    case DARK:
      return 'var(--color-logo-dark)';
    default:
      return 'transparent';
  }
}

export function PixelLogo({
  pixelSize = 12,
  pixelGap = 0,
  letterSpacing = 1,
  wordGap = 1,
}: PixelLogoProps) {
  const cellSize = pixelSize + pixelGap;

  return (
    <div className="flex items-center justify-center" aria-label="Hulala">
      {WORD_GROUPS.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className="flex items-center justify-center"
          style={{
            marginLeft: groupIndex > 0 ? `${wordGap * cellSize}px` : undefined,
            gap: `${letterSpacing * cellSize}px`,
          }}
        >
          {group.map((letter, letterIndex) => (
            <div
              key={`${groupIndex}-${letterIndex}`}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${LETTER_WIDTH}, ${pixelSize}px)`,
                gridTemplateRows: `repeat(${LETTER_HEIGHT}, ${pixelSize}px)`,
                gap: `${pixelGap}px`,
              }}
            >
              {letter.flat().map((pixel, pixelIndex) => (
                <div
                  key={pixelIndex}
                  style={{
                    width: pixelSize,
                    height: pixelSize,
                    backgroundColor: getColor(pixel),
                    borderRadius: 0,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
