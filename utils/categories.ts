export const APP_CATEGORIES = [
  'Academic',
  'Arts',
  'Sports',
  'Science & Tech',
  'Student Life',
  'Entrepreneurship',
] as const;

export const FRONTEND_CATEGORIES = APP_CATEGORIES;

export type FrontendCategory = (typeof APP_CATEGORIES)[number];

export const CATEGORY_FILTER_OPTIONS = ['All', ...APP_CATEGORIES] as const;
