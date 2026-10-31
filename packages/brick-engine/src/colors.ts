export type ColorFinish =
  | 'solid'
  | 'chrome'
  | 'pearl'
  | 'metal'
  | 'matte-metal'
  | 'rubber'
  | 'glitter'
  | 'speckle'
  | 'fabric'
  | 'custom';

export interface LDrawColor {
  id: number;
  name: string;
  hex: string;
  edge: string | number;
  alpha: number;
  luminance: number;
  finish: ColorFinish;
  material?: string;
}

export function parseLDrawColors(text: string): LDrawColor[] {
  const colors: LDrawColor[] = [];
  const seen = new Set<number>();
  const finishes: Record<string, ColorFinish> = {
    CHROME: 'chrome',
    PEARLESCENT: 'pearl',
    METAL: 'metal',
    MATTE_METALLIC: 'matte-metal',
    RUBBER: 'rubber',
  };
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== '0' || fields[1] !== '!COLOUR') continue;
    let id = NaN;
    let hex = '';
    let edge: string | number = '';
    let alpha = 255;
    let luminance = 0;
    let finish: ColorFinish = 'solid';
    let material: string | undefined;
    for (let index = 3; index < fields.length; index += 1) {
      const token = fields[index];
      if (token === 'CODE') id = Number(fields[++index]);
      else if (token === 'VALUE') hex = fields[++index];
      else if (token === 'EDGE') {
        const value = fields[++index];
        edge = value?.startsWith('#') ? value : Number(value);
      } else if (token === 'ALPHA') alpha = Number(fields[++index]);
      else if (token === 'LUMINANCE') luminance = Number(fields[++index]);
      else if (finishes[token]) finish = finishes[token];
      else if (token === 'MATERIAL') {
        const kind = fields[index + 1];
        if (!kind) throw new Error('Missing color material');
        finish =
          kind === 'GLITTER'
            ? 'glitter'
            : kind === 'SPECKLE'
              ? 'speckle'
              : kind === 'FABRIC'
                ? 'fabric'
                : 'custom';
        material = fields.slice(index + 1).join(' ');
        break;
      } else throw new Error(`Unknown color field: ${token}`);
    }
    if (
      !fields[2] ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      !/^#[\da-f]{6}$/i.test(hex) ||
      !(typeof edge === 'string'
        ? /^#[\da-f]{6}$/i.test(edge)
        : Number.isSafeInteger(edge) && edge >= 0) ||
      ![alpha, luminance].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    )
      throw new Error(`Invalid color definition: ${line}`);
    if (id === 16 || id === 24) continue;
    if (seen.has(id)) throw new Error(`Duplicate color code: ${id}`);
    seen.add(id);
    colors.push({
      id,
      name: fields[2].replaceAll('_', ' '),
      hex: hex.toLowerCase(),
      edge: typeof edge === 'string' ? edge.toLowerCase() : edge,
      alpha,
      luminance,
      finish,
      ...(material ? { material } : {}),
    });
  }
  return colors.sort((first, second) => first.id - second.id);
}
