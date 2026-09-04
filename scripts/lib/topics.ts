/**
 * Versioned topic vocabulary shared by pipeline assignment and search intent.
 *
 * Slugs are stable identifiers used by event records, URLs, and agent calls.
 * Labels are display text and may change without invalidating those references.
 * Keep assignment and search synonyms here so the two paths cannot drift.
 */

export const TOPIC_VOCABULARY_VERSION = 1 as const;

export const TOPIC_GROUPS = ["fields", "interests"] as const;
export type TopicGroup = (typeof TOPIC_GROUPS)[number];

export interface TopicDefinition {
  slug: string;
  label: string;
  group: TopicGroup;
  synonyms: readonly string[];
}

export const TOPICS = [
  {
    slug: "law",
    label: "Law",
    group: "fields",
    synonyms: ["law", "legal", "jurisprudence"],
  },
  {
    slug: "economics-policy",
    label: "Economics and Policy",
    group: "fields",
    synonyms: ["economics", "economic policy", "public policy", "policy"],
  },
  {
    slug: "health-medicine",
    label: "Health and Medicine",
    group: "fields",
    synonyms: ["health", "medicine", "medical", "public health"],
  },
  {
    slug: "history-humanities",
    label: "History and Humanities",
    group: "fields",
    synonyms: ["history", "humanities", "literature", "philosophy", "poetry"],
  },
  {
    slug: "biology-life-sciences",
    label: "Biology and Life Sciences",
    group: "fields",
    synonyms: ["biology", "life sciences", "biotech", "genomics"],
  },
  {
    slug: "ai-machine-learning",
    label: "AI and Machine Learning",
    group: "fields",
    synonyms: [
      "ai",
      "artificial intelligence",
      "machine learning",
      "language model",
      "language models",
      "llm",
    ],
  },
  {
    slug: "climate-energy",
    label: "Climate and Energy",
    group: "fields",
    synonyms: ["climate", "energy", "sustainability", "environment"],
  },
  {
    slug: "physics-math-quantum",
    label: "Physics, Math, and Quantum",
    group: "fields",
    synonyms: ["physics", "math", "mathematics", "quantum"],
  },
  {
    slug: "computer-science-data",
    label: "Computer Science and Data",
    group: "fields",
    synonyms: [
      "computer science",
      "data science",
      "eecs",
      "computing",
      "robotics",
    ],
  },
  {
    slug: "social-sciences",
    label: "Social Sciences",
    group: "fields",
    synonyms: [
      "social sciences",
      "sociology",
      "anthropology",
      "political science",
      "psychology",
    ],
  },
  {
    slug: "career-jobs",
    label: "Career and Jobs",
    group: "interests",
    synonyms: ["career", "careers", "job", "jobs", "career fair", "job fair"],
  },
  {
    slug: "film",
    label: "Film",
    group: "interests",
    synonyms: ["film", "movie", "cinema", "screening"],
  },
  {
    slug: "music-performance",
    label: "Music and Performance",
    group: "interests",
    synonyms: ["music", "concert", "live music", "opera", "recital"],
  },
  {
    slug: "theater-dance",
    label: "Theater and Dance",
    group: "interests",
    synonyms: ["theater", "dance", "drama", "choreography"],
  },
  {
    slug: "visual-arts-exhibitions",
    label: "Visual Arts and Exhibitions",
    group: "interests",
    synonyms: ["visual arts", "exhibition", "exhibitions", "museum"],
  },
  {
    slug: "free-food",
    label: "Free Food",
    group: "interests",
    synonyms: [
      "free food",
      "free lunch",
      "free dinner",
      "pizza",
      "snacks",
      "refreshments",
    ],
  },
  {
    slug: "social-clubs",
    label: "Social and Clubs",
    group: "interests",
    synonyms: [
      "club",
      "clubs",
      "social",
      "mixer",
      "info session",
      "student organization",
    ],
  },
  {
    slug: "wellness",
    label: "Wellness",
    group: "interests",
    synonyms: [
      "wellness",
      "wellbeing",
      "well-being",
      "mindfulness",
      "meditation",
      "yoga",
    ],
  },
  {
    slug: "startups",
    label: "Startups",
    group: "interests",
    synonyms: [
      "startup",
      "startups",
      "founder",
      "venture",
      "pitch",
      "demo day",
      "entrepreneur",
    ],
  },
  {
    slug: "workshops-skills",
    label: "Workshops and Skills",
    group: "interests",
    synonyms: ["workshop", "workshops", "skills", "training", "hands-on"],
  },
] as const satisfies readonly TopicDefinition[];

export type Topic = (typeof TOPICS)[number];
export type TopicSlug = Topic["slug"];

export const TOPIC_SLUGS: readonly TopicSlug[] = TOPICS.map(
  (topic) => topic.slug,
);

export const TOPIC_BY_SLUG: ReadonlyMap<TopicSlug, Topic> = new Map(
  TOPICS.map((topic) => [topic.slug, topic]),
);

export const TOPIC_VOCABULARY = {
  version: TOPIC_VOCABULARY_VERSION,
  topics: TOPICS,
} as const;

export interface TopicAssignableEvent {
  title: string;
  description?: string;
  organizer?: string;
  organizer_unit?: string;
  source?: string;
  source_name?: string;
  livewhale_groups?: readonly string[];
}

const ASSIGNMENT_TERMS: Partial<Record<TopicSlug, readonly string[]>> = {
  law: ["constitutional", "regulation", "privacy", "cybersecurity"],
  "economics-policy": [
    "economy",
    "macroeconomics",
    "microeconomics",
    "monetary",
    "governance",
  ],
  "health-medicine": [
    "healthcare",
    "clinical",
    "epidemiology",
    "mental health",
    "public health",
  ],
  "history-humanities": [
    "historical",
    "literary",
    "religion",
    "religious studies",
    "language",
  ],
  "biology-life-sciences": [
    "biological",
    "ecology",
    "microbiology",
    "microbiome",
    "molecular",
    "rna",
    "protein",
  ],
  "ai-machine-learning": [
    "deep learning",
    "reinforcement learning",
    "generative ai",
    "generative modeling",
    "generative model",
    "neural network",
    "computer vision",
    "diffusion model",
    "diffusion models",
    "autonomous agent",
    "alphafold",
    "chatbot",
    "data science",
    "robotics",
  ],
  "climate-energy": [
    "climate change",
    "renewable energy",
    "environmental",
    "conservation",
    "decarbonization",
  ],
  "physics-math-quantum": [
    "mathematical",
    "statistical",
    "statistics",
    "astrophysics",
    "astronomy",
  ],
  "computer-science-data": [
    "software",
    "algorithm",
    "data analytics",
    "cybersecurity",
    "computer vision",
    "informatics",
  ],
  "social-sciences": [
    "demography",
    "migration",
    "race and gender",
    "human behavior",
  ],
  "career-jobs": ["employment", "recruiting", "recruitment", "internship"],
  film: ["documentary", "filmmaking"],
  "music-performance": ["composer", "orchestra", "symphony"],
  "theater-dance": ["theatre", "performance studies"],
  "visual-arts-exhibitions": [
    "gallery",
    "visual art",
    "art exhibition",
    "installation",
  ],
  "free-food": ["food provided", "lunch provided", "dinner provided"],
  "social-clubs": [
    "student org",
    "student club",
    "general body meeting",
    "gbm",
  ],
  wellness: ["wellness", "wellbeing", "mental health"],
  startups: ["accelerator", "incubator", "venture capital"],
  "workshops-skills": ["professional development", "learn how to"],
};

const STRONG_DESCRIPTION_TERMS: Partial<Record<TopicSlug, readonly string[]>> =
  {
    "ai-machine-learning": [
      "machine learning",
      "deep learning",
      "reinforcement learning",
      "generative ai",
      "generative modeling",
      "large language model",
      "large language models",
      "neural network",
      "computer vision",
      "diffusion model",
      "diffusion models",
      "ai governance",
      "artificial intelligence, algorithms",
      "machine learning algorithm",
      "autonomous agent",
      "alphafold",
      "data science",
      "robotics",
    ],
  };

const ORGANIZER_TOPIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, readonly TopicSlug[]]
> = [
  [
    /\b(berkeley law|school of law|law school|bclt|bclb|jurisprudence)\b/i,
    ["law"],
  ],
  [
    /\b(economics|goldman school|public policy|governmental studies)\b/i,
    ["economics-policy"],
  ],
  [
    /\b(public health|university health services|medical|medicine)\b/i,
    ["health-medicine"],
  ],
  [
    /\b(history|humanities|german|english|classics|buddhist studies|linguistics|library)\b/i,
    ["history-humanities"],
  ],
  [
    /\b(biology|bioengineering|botanical|plant & microbial|molecular|chemistry)\b/i,
    ["biology-life-sciences"],
  ],
  [
    /\b(berkeley ai risk|club ai|berkeley institute for data science|bids|datasci|climb)\b/i,
    ["ai-machine-learning"],
  ],
  [
    /\b(environmental|geography|energy and resources|sustainability)\b/i,
    ["climate-energy"],
  ],
  [
    /\b(physics|mathematics|\bmath\b|statistics|astronomy|astrophysics)\b/i,
    ["physics-math-quantum"],
  ],
  [
    /\b(eecs|computer science|data science|school of information|\bieor\b|simons institute)\b/i,
    ["computer-science-data"],
  ],
  [
    /\b(social science matrix|sociology|anthropology|political science|psychology|race and gender)\b/i,
    ["social-sciences"],
  ],
  [/\b(career center|career engagement)\b/i, ["career-jobs"]],
  [/\b(bampfa)\b/i, ["film", "visual-arts-exhibitions"]],
  [/\b(department of music|cal performances)\b/i, ["music-performance"]],
  [
    /\b(theater, dance|theatre, dance|performance studies)\b/i,
    ["theater-dance"],
  ],
  [
    /\b(art practice|art museum|museum|gallery)\b/i,
    ["visual-arts-exhibitions"],
  ],
  [/\b(student organization|student club)\b/i, ["social-clubs"]],
  [/\b(recreational sports|wellness|counseling)\b/i, ["wellness"]],
  [
    /\b(haas|skydeck|e-?hub|entrepreneurship|gateway accelerator|scet)\b/i,
    ["startups"],
  ],
];

const SOURCE_TOPICS: Readonly<Record<string, readonly TopicSlug[]>> = {
  ai_risk: ["ai-machine-learning", "computer-science-data"],
  bampfa: ["film", "visual-arts-exhibitions"],
  berkeley_law: ["law"],
  cal_performances: ["music-performance"],
  haas: ["startups"],
  simons: ["computer-science-data"],
};

const GROUP_TOPICS: Readonly<Record<string, readonly TopicSlug[]>> = {
  physics: ["physics-math-quantum"],
  mathematics: ["physics-math-quantum"],
  statistics: ["physics-math-quantum", "computer-science-data"],
  "integrative biology": ["biology-life-sciences"],
  bioengineering: ["biology-life-sciences"],
  "plant and microbial biology": ["biology-life-sciences"],
  "botanical garden": ["biology-life-sciences", "climate-energy"],
  "college of chemistry": ["biology-life-sciences"],
  law: ["law"],
  economics: ["economics-policy"],
  "political science": ["social-sciences", "economics-policy"],
  psychology: ["social-sciences"],
  "social science matrix": ["social-sciences"],
  "center for race and gender": ["social-sciences"],
  "human rights center": ["law", "social-sciences"],
  history: ["history-humanities"],
  linguistics: ["history-humanities"],
  german: ["history-humanities"],
  classics: ["history-humanities"],
  "buddhist studies": ["history-humanities"],
  english: ["history-humanities"],
  scandinavian: ["history-humanities"],
  library: ["history-humanities"],
  music: ["music-performance"],
  geography: ["climate-energy", "social-sciences"],
  "school of information": ["computer-science-data"],
  "college of engineering": ["computer-science-data"],
  "lawrence hall of science": ["physics-math-quantum"],
  "helen wills neuroscience institute": [
    "health-medicine",
    "biology-life-sciences",
  ],
  "college of environmental design": ["climate-energy"],
};

const CONFIDENCE_FLOOR = 20;
const GROUP_WEIGHT = 100;
const SOURCE_WEIGHT = 70;
const ORGANIZER_WEIGHT = 50;
const TITLE_WEIGHT = 30;
const DESCRIPTION_WEIGHT = 10;
const STRONG_DESCRIPTION_WEIGHT = 20;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termRegex(term: string): RegExp {
  const body = escapeRegex(term.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}(?=$|[^\\p{L}\\p{N}])`, "giu");
}

function countTerm(text: string, term: string): number {
  return text.match(termRegex(term))?.length ?? 0;
}

function countTerms(text: string, terms: readonly string[]): number {
  const alternatives = [...terms]
    .sort((left, right) => right.length - left.length)
    .map((term) => escapeRegex(term.trim()).replace(/\s+/g, "\\s+"));
  if (alternatives.length === 0) return 0;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${alternatives.join("|")})(?=$|[^\\p{L}\\p{N}])`,
    "giu",
  );
  return text.match(pattern)?.length ?? 0;
}

function allTerms(topic: Topic): readonly string[] {
  return [...topic.synonyms, ...(ASSIGNMENT_TERMS[topic.slug] ?? [])];
}

/**
 * Assign zero to three topic slugs using only deterministic local signals.
 * Identity fields clear the floor on their own. Description text needs either
 * repeated evidence or one precise technical phrase.
 */
export function assignTopics(event: TopicAssignableEvent): TopicSlug[] {
  const scores = new Map<TopicSlug, number>(
    TOPICS.map((topic) => [topic.slug, 0]),
  );
  const add = (slug: TopicSlug, weight: number): void => {
    scores.set(slug, (scores.get(slug) ?? 0) + weight);
  };

  for (const group of event.livewhale_groups ?? []) {
    for (const slug of GROUP_TOPICS[group.trim().toLowerCase()] ?? []) {
      add(slug, GROUP_WEIGHT);
    }
  }

  const source = event.source_name ?? event.source ?? "";
  for (const slug of SOURCE_TOPICS[source] ?? []) add(slug, SOURCE_WEIGHT);

  const organizer = [event.organizer, event.organizer_unit]
    .filter(Boolean)
    .join(" ");
  for (const [pattern, slugs] of ORGANIZER_TOPIC_PATTERNS) {
    if (!pattern.test(organizer)) continue;
    for (const slug of slugs) add(slug, ORGANIZER_WEIGHT);
  }

  for (const topic of TOPICS) {
    const terms = allTerms(topic);
    const titleHits = countTerms(event.title, terms);
    const descriptionHits = countTerms(event.description ?? "", terms);
    if (titleHits > 0) add(topic.slug, titleHits * TITLE_WEIGHT);
    if (descriptionHits > 0) {
      add(topic.slug, descriptionHits * DESCRIPTION_WEIGHT);
    }
    for (const term of STRONG_DESCRIPTION_TERMS[topic.slug] ?? []) {
      if (countTerm(event.description ?? "", term) > 0) {
        add(topic.slug, STRONG_DESCRIPTION_WEIGHT);
      }
    }
  }

  return TOPICS.map((topic, index) => ({
    slug: topic.slug,
    score: scores.get(topic.slug) ?? 0,
    index,
  }))
    .filter(({ score }) => score >= CONFIDENCE_FLOOR)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map(({ slug }) => slug);
}
