/**
 * Hand-authored tile layouts for the tilemap chart, the way tile-grid maps are
 * made in practice (NPR, FT, Economist and the tile-grid literature): a person
 * places each tile, and a check holds the result to the real geography.
 * The grid generator in an earlier version placed tiles greedily from the
 * projected anchors; dense areas then pushed small countries into wrong cells
 * (Czechia south of Austria, the United Kingdom south of Luxembourg).
 *
 * Each row is one grid row, tokens separated by spaces, `.` for an empty cell.
 * `prefix` is put in front of every token (us-states ids are `US-<postal>`).
 * scripts/build-geo-packs.mjs refuses a layout that fails tileLayoutFaults.
 */
export const TILE_LAYOUTS = {
  eu27: {
    prefix: '',
    rows: [
      '.  .  .  .  .  SE FI .  .  . ',
      '.  .  .  .  .  .  EE .  .  . ',
      '.  .  .  .  DK .  LV .  .  . ',
      'IE .  .  NL DE PL LT .  .  . ',
      '.  .  .  BE LU CZ SK .  RO . ',
      '.  .  .  FR IT AT HR HU BG . ',
      'PT ES .  .  MT SI .  GR .  CY',
    ],
  },
  europe: {
    prefix: '',
    rows: [
      'IS .  .  .  .  NO SE FI .  .  .  . ',
      '.  FO .  .  .  .  AX EE .  .  .  . ',
      '.  .  .  .  .  DK .  .  LV .  .  . ',
      '.  IE IM GB NL DE .  PL LT BY .  . ',
      '.  GG JE BE LU .  CZ SK .  .  UA . ',
      '.  .  .  FR CH LI AT HU .  RO MD . ',
      '.  PT ES AD MC IT SI HR BA RS BG . ',
      '.  .  GI .  .  SM .  .  ME XK .  . ',
      '.  .  .  .  .  VA .  .  AL MK .  . ',
      '.  .  .  .  .  MT .  .  .  GR .  CY',
    ],
  },
  'us-states': {
    prefix: 'US-',
    rows: [
      '.  .  .  ND .  .  .  .  .  .  ME',
      '.  WA MT SD MN WI MI .  NY VT NH',
      'OR ID WY NE IA IL IN OH PA MA RI',
      'CA NV UT CO KS MO KY WV MD NJ CT',
      '.  AZ NM OK AR MS TN .  VA DC DE',
      '.  AK .  TX LA .  AL GA SC NC . ',
      '.  .  .  HI .  .  .  FL .  .  . ',
    ],
  },
  world: {
    prefix: '',
    rows: [
      '.   .   .   .   .   .   .   .   .   .   GL  .   IS  .   .   .   .   NO  SE  FI  .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .  ',
      '.   .   .   .   .   .   .   .   .   .   .   .   .   FO  .   .   .   .   AX  EE  .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .  ',
      '.   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   DK  .   .   LV  .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .  ',
      '.   .   .   CA  .   .   .   .   PM  .   .   .   .   IE  IM  GB  NL  DE  .   PL  LT  BY  .   .   .   .   .   .   .   RU  .   .   .   .   .   .   .   .   .  ',
      '.   .   .   US  .   .   .   .   .   .   .   .   .   GG  JE  BE  LU  .   CZ  SK  .   .   UA  .   .   .   .   .   KZ  .   MN  KP  .   .   .   .   .   .   .  ',
      '.   .   .   .   .   .   .   BM  .   .   .   .   .   .   .   FR  CH  LI  AT  HU  .   RO  MD  .   GE  .   .   .   UZ  KG  CN  KR  JP  .   .   .   .   .   .  ',
      '.   .   .   .   .   BS  .   .   .   MF  .   .   .   PT  ES  AD  MC  IT  SI  HR  BA  RS  BG  TR  AM  AZ  .   TM  TJ  .   .   .   .   .   .   .   .   .   .  ',
      '.   .   MX  .   .   CU  TC  VG  AI  BL  .   .   .   .   GI  .   .   SM  .   .   ME  XK  .   CYN .   SY  IQ  IR  AF  .   .   .   VN  HK  TW  .   .   .   .  ',
      '.   GT  BZ  KY  JM  HT  DO  PR  VI  SX  AG  .   .   .   MA  .   .   VA  .   .   AL  MK  .   CY  LB  .   KW  .   PK  NP  BT  .   LA  MO  .   .   MP  .   .  ',
      '.   SV  HN  .   .   .   .   KN  MS  DM  BB  .   .   .   .   .   TN  MT  .   .   .   GR  .   .   PS  .   .   BH  .   IN  BD  MM  TH  .   .   .   GU  FM  .  ',
      'UM  .   NI  .   .   .   AW  CW  LC  VC  .   .   .   EH  .   .   DZ  .   LY  .   EG  .   .   IL  .   JO  SA  QA  .   .   .   .   .   KH  .   PH  PW  .   MH ',
      '.   .   .   CR  PA  .   .   .   GD  TT  .   CV  SN  MR  ML  .   NE  .   TD  SD  .   ER  .   .   .   .   YE  AE  OM  .   LK  .   MY  .   BN  .   .   .   .  ',
      'WF  WS  AS  .   EC  CO  VE  GY  SR  .   .   .   GM  .   .   BF  BJ  NG  .   CF  SS  .   ET  DJ  SOL .   .   .   .   MV  .   .   SG  ID  .   .   .   NR  KI ',
      'NU  CK  .   PF  .   PE  BR  .   .   .   .   .   GW  GN  CI  GH  TG  .   CM  .   .   UG  KE  SO  .   .   .   .   .   IO  .   .   .   .   TL  PG  SB  .   TV ',
      'TO  .   .   .   .   BO  PY  .   .   .   .   .   SL  LR  .   .   .   ST  GQ  CG  CD  RW  .   .   SC  .   .   .   .   .   .   .   .   .   .   .   .   VU  FJ ',
      '.   .   .   .   .   CL  AR  UY  .   .   .   .   .   .   .   .   .   .   GA  .   .   BI  TZ  .   .   .   .   .   .   .   .   .   .   .   AU  .   NC  .   .  ',
      '.   .   .   .   PN  .   .   .   .   .   .   .   .   .   .   .   .   .   .   AO  ZM  MW  MZ  KM  .   .   .   .   .   .   .   .   .   .   .   .   NF  .   .  ',
      '.   .   .   .   .   .   .   .   FK  .   GS  .   .   .   .   SH  .   .   .   NA  BW  ZW  .   MG  MU  .   .   .   .   .   .   .   .   .   .   .   NZ  .   .  ',
      '.   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   ZA  LS  SZ  .   TF  .   .   .   .   .   .   .   .   .   .   .   .   .   .  ',
      '.   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   AQ  .   .   HM  .   .   .   .   .   .   .   .   .   .   .   .   .   .  ',
    ],
  },
};

/** How many nearest anchors count as a region's main neighbours, next to its land neighbours. */
const NEAREST = 3;
/** A tile neighbour must be among the other region's nearest anchors (or a land neighbour). */
const CLOSE_RANK = 6;
/** An offset is "mainly" along one axis when that axis is at least twice the other. */
const AXIS_RATIO = 2;

/**
 * Direction check for one layout. `regions` carry the projected anchor (x, y,
 * y down) and the tile cell (row, col); `landPairs` are the shared-border
 * pairs. Two faults:
 * - direction: for a main-neighbour pair, the tile offset points more than
 *   90 degrees away from the anchor offset, or the anchor offset lies mainly
 *   along one axis (north, south, east, west) and the tile offset does not go
 *   that way on that axis.
 * - distant: two tiles touch (share an edge) but neither region is a land
 *   neighbour or one of the other's nearest anchors.
 */
export function tileLayoutFaults(regions, landPairs) {
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const land = new Set(landPairs.map(({ a, b }) => key(a, b)));
  const byId = new Map(regions.map((region) => [region.id, region]));
  const nearest = new Map(
    regions.map((region) => [
      region.id,
      regions
        .filter((other) => other !== region)
        .map((other) => ({ id: other.id, d: Math.hypot(other.x - region.x, other.y - region.y) }))
        .sort((p, q) => p.d - q.d || (p.id < q.id ? -1 : 1))
        .map(({ id }) => id),
    ]),
  );
  const main = new Set(land);
  for (const [id, ids] of nearest) for (const other of ids.slice(0, NEAREST)) main.add(key(id, other));

  const faults = [];
  for (const pair of [...main].sort()) {
    const [a, b] = pair.split('|').map((id) => byId.get(id));
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const tx = b.col - a.col;
    const ty = b.row - a.row;
    const wrongAxis =
      (Math.abs(vx) >= AXIS_RATIO * Math.abs(vy) && Math.sign(tx) !== Math.sign(vx)) ||
      (Math.abs(vy) >= AXIS_RATIO * Math.abs(vx) && Math.sign(ty) !== Math.sign(vy));
    if (vx * tx + vy * ty <= 0 || wrongAxis) {
      faults.push({ a: a.id, b: b.id, kind: 'direction', geo: compass(vx, vy), tile: compass(tx, ty) });
    }
  }
  const at = new Map(regions.map((region) => [`${region.row}:${region.col}`, region]));
  for (const region of regions) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const other = at.get(`${region.row + dr}:${region.col + dc}`);
      if (!other) continue;
      const pair = key(region.id, other.id);
      if (land.has(pair)) continue;
      const close =
        nearest.get(region.id).indexOf(other.id) < CLOSE_RANK ||
        nearest.get(other.id).indexOf(region.id) < CLOSE_RANK;
      if (!close) faults.push({ a: region.id, b: other.id, kind: 'distant' });
    }
  }
  return faults;
}

function compass(x, y) {
  const ns = Math.abs(y) * AXIS_RATIO >= Math.abs(x) && y !== 0 ? (y < 0 ? 'N' : 'S') : '';
  const ew = Math.abs(x) * AXIS_RATIO >= Math.abs(y) && x !== 0 ? (x < 0 ? 'W' : 'E') : '';
  return ns + ew || 'same';
}

/** Parses a layout into `{ id, row, col }` cells and the grid size; throws on a malformed grid. */
export function parseTileLayout(packId, layout) {
  const grid = layout.rows.map((row) => row.trim().split(/\s+/));
  const cols = Math.max(...grid.map((tokens) => tokens.length));
  const cells = [];
  grid.forEach((tokens, row) => {
    if (tokens.length !== cols) {
      throw new Error(`${packId} tile layout: row ${row} has ${tokens.length} cells, expected ${cols}`);
    }
    tokens.forEach((token, col) => {
      if (token !== '.') cells.push({ id: `${layout.prefix}${token}`, row, col });
    });
  });
  return { rows: grid.length, cols, cells };
}
