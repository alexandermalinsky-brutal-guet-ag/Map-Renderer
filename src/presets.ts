export type Preset = {
  id: string;
  name: string;
  lng: number;
  lat: number;
};

export const PRESETS: Preset[] = [
  { id: 'vaudoise-arena',     name: 'Vaudoise Aréna — Lausanne',            lng: 6.5830, lat: 46.5207 },
  { id: 'stade-tuiliere',     name: 'Stade de la Tuilière — Lausanne (FC LS)', lng: 6.6342, lat: 46.5475 },
  { id: 'postfinance-arena',  name: 'PostFinance Arena — Bern (SCB)',       lng: 7.4643, lat: 46.9461 },
  { id: 'wankdorf',           name: 'Stadion Wankdorf — Bern (YB)',         lng: 7.4650, lat: 46.9630 },
  { id: 'st-jakob-park',      name: 'St. Jakob-Park — Basel (FCB)',         lng: 7.6205, lat: 47.5416 },
  { id: 'letzigrund',         name: 'Letzigrund — Zürich',                  lng: 8.5036, lat: 47.3822 },
  { id: 'swiss-life-arena',   name: 'Swiss Life Arena — Zürich (ZSC)',      lng: 8.5008, lat: 47.3742 },
  { id: 'hallenstadion',      name: 'Hallenstadion — Zürich',               lng: 8.5519, lat: 47.4109 },
  { id: 'stade-de-geneve',    name: 'Stade de Genève — Genève (Servette)',  lng: 6.1275, lat: 46.1781 },
  { id: 'lonza-arena',        name: 'Lonza Arena — Visp (EHC Visp)',         lng: 7.8744, lat: 46.2933 },
];
