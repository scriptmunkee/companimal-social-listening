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

export const QUERY_VERSION = "2026-11-13.3";

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

// ---------------------------------------------------------------------------
// Reddit (via Google's licensed index of Reddit; no direct Reddit access)
// ---------------------------------------------------------------------------
// Extra angles for subreddit searches, rotated daily so each subreddit is searched
// from a few directions (Google returns only a handful of results per site: search).
export const REDDIT_FACETS = ["puppy", "breeder", "rescue", "vet", "training", "advice", "help", "first time", "anxiety", "food", "aggressive", "insurance", "cost", "crate", "walk"];
export const REDDIT_FACETS_PER_DAY = 2;

// Topic searches that trigger Google's "Discussions and forums" block, which lists Reddit
// threads WITH comment counts. Normal (not site:) searches, so 5x cheaper than site: ones.
export const REDDIT_TOPIC_QUERIES: string[] = [
  // Buyers
  "how to find a reputable dog breeder uk", "questions to ask a breeder before buying a puppy", "puppy deposit before viewing is it normal",
  "how to tell if a puppy is from a puppy farm", "puppy scam paid deposit", "is it better to adopt or buy a puppy",
  "best dog breed for first time owner uk", "best dog breed for family with young kids", "hypoallergenic dog breeds that actually work",
  "cockapoo vs cavapoo which is better", "how much should a puppy cost uk", "is pet insurance worth it for a puppy",
  "regret getting a puppy", "puppy blues", "first week with a new puppy",
  // New owners
  "puppy crying in crate at night", "puppy biting everything", "puppy toilet training not working",
  "when can my puppy go outside after vaccinations", "how long can a puppy be left alone", "puppy won't sleep through the night",
  "puppy socialisation before vaccinations", "puppy pulling on lead", "recall training not working",
  "dog separation anxiety help", "reactive dog on walks", "dog barking at everything",
  "dog bit me what should i do", "rescue dog settling in", "dog scared of fireworks",
  "how much to feed a puppy", "raw feeding vs kibble", "dog eats everything on walks",
  "best way to groom a doodle", "dog vet bills too expensive", "dog insurance claim rejected",
  // Breeders
  "selling puppies tips for breeders", "where to advertise puppies uk", "how to vet puppy buyers",
  "puppy buyers time wasters", "do i need a licence to breed dogs uk", "first litter what to expect",
  "whelping puppies advice", "puppy contract what to include", "breeder keeping in touch with puppy owners",
  "breeding my dog once is it worth it", "kennel club registration worth it", "health testing before breeding",
  // Rescue and rehoming
  "rehoming my dog guilt", "how to rehome a dog responsibly uk", "rescue rejected our application",
  "adopting a rescue dog uk experience", "foster to adopt dog", "dog returned to rescue",
  // UK specifics
  "dog friendly uk", "xl bully ban", "dog theft uk", "dog walker cost uk", "doggy daycare worth it",
];
// Google shows the Discussions block (with comment counts) on roughly a third of searches,
// about two Reddit threads each time, so breadth and daily repetition is what builds coverage.
export const REDDIT_TOPIC_PER_DAY = 1000;   // the whole bank, every day (~$0.0006 each)
export const REDDIT_SNOWBALL_PER_DAY = 30;  // plus fresh questions harvested from Reddit itself
export const REDDIT_TRACKED_PER_DAY = 40;   // plus re-running searches that recently surfaced commented threads
export const REDDIT_INSIGHTS_PER_RUN = 96;  // threads analysed per 10-minute run

// ---------------------------------------------------------------------------
// Reddit via Serpent API (apiserpent.com): real listings, upvotes, post bodies and comments.
// Used whenever the SERPENT_API_KEY secret is set; otherwise the Google route above runs.
// Pricing: $0.12 per 1,000 calls; posts and comments are billed per started block of 25.
// ---------------------------------------------------------------------------
// Subreddit feeds, refreshed every few hours so upvote and comment growth is measured.
export const REDDIT_FEEDS: { sort: "new" | "hot" | "rising"; limit: number }[] = [
  { sort: "new", limit: 100 },   // every new thread
  { sort: "hot", limit: 50 },    // what the subreddit is talking about now
  { sort: "rising", limit: 25 }, // what's taking off
];
export const REDDIT_FEEDS_EVERY_HOURS = 3;
// Once a day: the best of the week and the month
export const REDDIT_TOP: { t: "week" | "month"; limit: number }[] = [
  { t: "week", limit: 100 },
  { t: "month", limit: 50 },
];
// Extra daily searches inside the UK subreddits (whose feeds are mostly not about dogs)
export const REDDIT_UK_SEARCHES = [
  "subreddit:AskUK dog", "subreddit:AskUK puppy", "subreddit:AskUK dog breeder", "subreddit:AskUK rescue dog",
  "subreddit:CasualUK dog", "subreddit:CasualUK puppy", "subreddit:unitedkingdom dog", "subreddit:LegalAdviceUK dog",
  "subreddit:UKPersonalFinance dog", "subreddit:UKPersonalFinance pet insurance",
];
// Posts in filtered subreddits must mention dogs in the title or body
export const REDDIT_DOG_FILTER = /\b(dogs?|pupp(y|ies)|pups?|canine|breeders?|rescue dog|kennels?|whelp\w*|litters?|spaniel|labrador|retriever|terrier|poodle|cockapoo|cavapoo|doodle|bulldog|collie|dachshund|pug|husky|greyhound|lurcher|staff(ie|y)|xl bully|dog walker|doggy daycare)\b/i;
// Comment threads: fetched once a thread has a few comments, again when it keeps growing
export const REDDIT_COMMENTS_MIN = 3;           // skip threads with fewer comments than this
export const REDDIT_COMMENTS_PER_DAY = 1000;    // ceiling on comment fetches a day (about $0.15)
export const REDDIT_COMMENTS_PER_TICK = 40;     // per 10-minute run
export const REDDIT_COMMENTS_REFETCH_GROWTH = 1.5; // fetch again when comments grow by half (and by 10+)
export const REDDIT_COMMENTS_TOP = 6;            // top comments shown to the AI per thread

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
