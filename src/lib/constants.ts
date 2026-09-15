export const FACTORS = [2, 4, 8] as const;

export const WEIGHTS_BIN = `${import.meta.env.BASE_URL}weights/rt_v7s.bin`;
export const WEIGHTS_MANIFEST = `${import.meta.env.BASE_URL}weights/rt_v7s.json`;

export const MAX_ALLOWED_FRAMES = 6000;
export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1920;

export const ENCODE_BITRATE = 12_000_000;
export const ENCODE_CODEC = 'avc1.42001f';
export const SCENE_CUT_THRESHOLD = 24;