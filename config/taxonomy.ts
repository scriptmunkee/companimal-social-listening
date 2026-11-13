// Companimal topic taxonomy and seed queries.
// Edit freely. Every change to queries should bump QUERY_VERSION so trend lines
// can be read against the query set that produced them.

export const PROJECT = {
  id: "companimal",
  name: "Companimal",
  site: "https://companimal.co.uk",
  sitemap: "https://companimal.co.uk/sitemap.xml",
  locationCode: 2826, // United Kingdom
  languageCode: "en",
};

export const QUERY_VERSION = "2026-11-13.2";

export type Lens = "buyer" | "breeder" | "rescue" | "owner";

export interface Topic {
  id: string;
  label: string;
  lens: Lens[];
  keywords: string[]; // used by the heuristic tagger and URL matcher
}

export const TOPICS: Topic[] = [
  { id: "buying-a-puppy", label: "Buying a puppy", lens: ["buyer"], keywords: ["buy a puppy", "buying a puppy", "puppy for sale", "deposit", "viewing", "breeder questions", "pick up puppy", "where to buy"] },
  { id: "scams-fraud", label: "Puppy scams and fraud", lens: ["buyer", "breeder"], keywords: ["scam", "scammer", "fraud", "fake breeder", "puppy farm", "backyard breeder", "stolen", "too good to be true"] },
  { id: "costs", label: "Costs, insurance and vet bills", lens: ["buyer", "owner"], keywords: ["cost", "price", "how much", "insurance", "vet bill", "expensive", "afford"] },
  { id: "breed-choice", label: "Choosing a breed", lens: ["buyer"], keywords: ["which breed", "best breed", "family dog", "hypoallergenic", "first dog", "breed for", "temperament"] },
  { id: "health", label: "Health and health testing", lens: ["buyer", "owner", "breeder"], keywords: ["vaccination", "jab", "health test", "hip score", "worming", "flea", "vet", "illness", "sick", "neuter", "spay"] },
  { id: "training-behaviour", label: "Training and behaviour", lens: ["owner"], keywords: ["toilet training", "potty", "crate", "biting", "nipping", "separation anxiety", "recall", "barking", "lead pulling", "reactive", "socialisation"] },
  { id: "new-puppy-prep", label: "Bringing a puppy home", lens: ["buyer", "owner"], keywords: ["first night", "bringing home", "what to buy", "puppy checklist", "settling in", "8 weeks"] },
  { id: "feeding", label: "Feeding", lens: ["owner"], keywords: ["food", "feeding", "raw", "kibble", "how much to feed", "treats"] },
  { id: "breeding-litters", label: "Breeding and litters", lens: ["breeder"], keywords: ["litter", "whelping", "pregnant", "stud", "breeding", "season", "dam", "sire"] },
  { id: "selling-puppies", label: "Selling puppies", lens: ["breeder"], keywords: ["sell puppies", "selling puppies", "advertise puppies", "puppy contract", "deposits", "pets4homes", "listing", "time wasters"] },
  { id: "licensing-law", label: "Breeder licensing and the law", lens: ["breeder", "buyer"], keywords: ["licence", "license", "council", "lucy's law", "registered breeder", "kennel club", "legal", "microchip"] },
  { id: "rescue-rehoming", label: "Rescue and rehoming", lens: ["rescue", "buyer"], keywords: ["rescue", "rehome", "rehoming", "adopt", "adoption", "shelter", "surrender", "foster"] },
  { id: "seasonal", label: "Seasonal (fireworks, heat, Christmas)", lens: ["owner"], keywords: ["fireworks", "bonfire", "christmas puppy", "heatwave", "hot weather", "snow", "halloween"] },
  { id: "grooming", label: "Grooming", lens: ["owner"], keywords: ["groom", "grooming", "haircut", "shedding", "coat", "nail"] },
  { id: "other", label: "Other", lens: ["owner"], keywords: [] },
];

export const LENSES: { id: Lens; label: string }[] = [
  { id: "buyer", label: "Buyers" },
  { id: "breeder", label: "Breeders" },
  { id: "rescue", label: "Rescues and rehomers" },
  { id: "owner", label: "Owners" },
];

// Google SERP queries (UK). "forum" queries run daily, a rotating slice per day,
// limited to the past month and kept for Reddit and forum threads.
// "paa" queries run weekly, unfiltered, for People Also Ask and Discussions and forums.
export const SERP_FORUM_QUERIES: string[] = [
  "buying a puppy uk reddit",
  "puppy scam uk reddit",
  "dog breeder uk reddit",
  "selling puppies uk reddit",
  "rehoming dog uk reddit",
  "first time dog owner uk reddit",
  "puppy cost uk reddit",
  "which dog breed uk reddit",
  "puppy training help reddit",
  "dog breeding licence uk reddit",
  "puppy farm uk reddit",
  "rescue dog uk reddit",
  // UK communities (plain words, not site: operators, which DataForSEO charges 5x for)
  "puppy advice mumsnet",
  "dog advice netmums",
  "champdogs forum puppy",
  "askuk reddit dog",
  "casualuk reddit puppy",
];
export const SERP_FORUM_PER_DAY = 6; // rotate through the list, 6 searches a day

// Subreddits read daily through Google (site: search, past week, deduplicated by URL).
// Gives thread titles and Google's snippet, which is where the question usually is.
// site: queries cost 5x a normal search, roughly $0.01 per subreddit per day at depth 30.
export const SUBREDDITS: { sub: string; filter?: string }[] = [
  { sub: "dogs" },
  { sub: "puppy101" },
  { sub: "DogAdvice" },
  { sub: "Dogtraining" },
  { sub: "rescuedogs" },
  { sub: "AskUK", filter: "dog OR puppy" },
  { sub: "CasualUK", filter: "dog OR puppy" },
];
export const SUBREDDIT_DEPTH = 30;

export const SERP_PAA_QUERIES: string[] = [
  "buying a puppy",
  "how to sell puppies",
  "how much does a puppy cost uk",
  "rehoming a dog uk",
  "dog breeding licence",
  "best family dog uk",
  "how to spot a puppy scam",
  "first night with a puppy",
  "puppy insurance uk",
  "questions to ask a dog breeder",
  "puppy contract uk",
  "adopting a rescue dog uk",
];

// YouTube: daily searches for recent UK videos, then comments on the top results.
export const YOUTUBE_QUERIES: string[] = [
  "buying a puppy uk",
  "first time dog owner uk",
  "dog breeder uk",
  "puppy training tips",
  "rescue dog uk",
  "puppy scam",
];
export const YOUTUBE_VIDEOS_PER_QUERY = 3;

// UK channels: each name is looked up once and remembered. Unfound names are skipped
// and listed on the Sources page. Recent uploads (last 30 days) get their comments read.
export const YOUTUBE_UK_CHANNELS: string[] = [
  "@Jamiepenrithdogtraining",
  "Will Atherton Canine Academy",
  "Dogs Trust",
  "Southend Dog Training",
  "Adolescent Dogs",
  "Battersea Dogs and Cats Home",
  "The Kennel Club",
  "Graeme Hall Dogfather",
];
export const YOUTUBE_UPLOADS_PER_CHANNEL = 2;
export const YOUTUBE_LOOKBACK_DAYS = 30;

// DataForSEO Content Analysis: web, forum and blog citations, daily.
export const CONTENT_ANALYSIS_KEYWORDS: string[] = [
  "\"buying a puppy\"",
  "\"puppy scam\"",
  "\"dog breeder\"",
  "\"rehoming a dog\"",
];
export const CONTENT_ANALYSIS_LIMIT = 50;
// Web mentions: only .uk sites plus these UK forums
export const UK_FORUM_DOMAINS = ["mumsnet.com", "netmums.com", "champdogs.co.uk", "pistonheads.com", "moneysavingexpert.com", "digitalspy.com"];

// Region signals for the rules-based tagger (the AI also judges region).
export const UK_SIGNALS = ["£", " uk", "u.k.", "britain", "british", "england", "scotland", "wales", "northern ireland", "nhs", "council", "kennel club", "rspca", "dogs trust", "blue cross", "pdsa", "battersea", "lucy's law", "jabs", "pets4homes", "preloved", "gumtree", "london", "manchester", "birmingham", "leeds", "glasgow", "liverpool", "newcastle", "bristol", "cardiff", "edinburgh", "sheffield", "nottingham", "durham", "yorkshire", "mum ", "colour", "neighbour", "favourite"];
export const NON_UK_SIGNALS = ["$", "usd", "akc", "aspca", "humane society", "petsmart", "petco", "chewy", "zip code", "puppy shots", "texas", "california", "florida", "new york", "ohio", "canada", "australia", "aussie", "rspca australia", "mom ", "color ", "favorite"];

// Raw archive objects older than this are flagged for deletion (personal data minimisation).
// Daily rollups and extracted questions (no usernames) are kept indefinitely.
export const RAW_RETENTION_DAYS = 730;
