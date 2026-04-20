export const FRONTEND_CATEGORIES = [
  'Academic',
  'Arts',
  'Sports',
  'Science & Tech',
  'Student Life',
  'Entrepreneurship',
] as const;

export type FrontendCategory = (typeof FRONTEND_CATEGORIES)[number];

export const CATEGORY_FILTER_OPTIONS = ['All', ...FRONTEND_CATEGORIES] as const;
