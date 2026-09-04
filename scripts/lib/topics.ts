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
