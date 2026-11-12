// Fixture data for local testing only (MOCK=1). Never used in production.
const SAMPLES = [
  "How do I know if a breeder is legit? Seller wants a £300 deposit before we've even seen the puppy",
  "Is it true you shouldn't take a puppy out before the second jab?",
  "We got our cockapoo from a licensed breeder last year and it was the best decision",
  "What questions should I ask a dog breeder on the first call?",
  "Struggling with toilet training, 10 week old lab still going indoors",
  "How much does a puppy actually cost per month in the UK?",
  "Which breed is best for a family with young kids and a small garden?",
  "Do I need a licence to sell one litter of puppies?",
  "Where is the best place to advertise puppies now that Facebook groups ban sales?",
  "How do you spot a puppy farm advert?",
  "Our rescue greyhound is terrified of the fireworks, any tips?",
  "Is pet insurance worth it for a puppy?",
  "My friend says mixed breeds are always healthier than pedigrees",
  "How long after the first jab can a puppy go outside?",
  "Can I rehome my dog without going through a rescue?",
  "Got scammed out of £500 on a fake spaniel advert, what can I do?",
  "What should a puppy contract include?",
  "First night with our puppy and she cried for hours, is that normal?",
  "Time wasters are driving me mad, how do other breeders vet buyers?",
  "Is it cheaper to adopt a rescue dog than buy a puppy?",
];
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

export function mockSerp(kind: string, query: string) {
  const items: any[] = [];
  for (let i = 0; i < 6; i++) {
    const t = pick(SAMPLES);
    items.push({ type: "organic", url: `https://www.reddit.com/r/${pick(["dogs", "puppy101", "AskUK", "DogAdvice"])}/comments/${Math.floor(rnd() * 1e6)}/x`, domain: "www.reddit.com", title: t, description: t });
  }
  if (kind === "paa") items.push({ type: "people_also_ask", items: [0, 1, 2].map(() => { const t = pick(SAMPLES.filter((s) => s.includes("?"))); return { title: t.split("?")[0] + "?", expanded_element: [{ url: "https://www.example.co.uk/guide", domain: "www.example.co.uk", description: "Answer text" }] }; }) });
  items.push({ type: "discussions_and_forums", items: [0, 1].map(() => ({ url: `https://www.mumsnet.com/talk/${Math.floor(rnd() * 1e6)}`, title: pick(SAMPLES), source: "Mumsnet" })) });
  return { cost: 0, tasks: [{ status_code: 20000, result: [{ keyword: query, items }] }] };
}

export function mockContentAnalysis(kw: string) {
  return { cost: 0, tasks: [{ result: [{ items: Array.from({ length: 5 }, () => ({ url: `https://blog.example.co.uk/${Math.floor(rnd() * 1e6)}`, domain: "blog.example.co.uk", content_info: { title: kw, snippet: pick(SAMPLES), date_published: new Date().toISOString() } })) }] }] };
}

export function mockYoutubeSearch(q: string) {
  return { items: [0, 1].map(() => ({ id: { videoId: `vid${Math.floor(rnd() * 1e6)}` }, snippet: { title: `Video about ${q}`, channelTitle: pick(["Puppy School UK", "Dog Trainer Dan", "Rescue Diaries"]) } })) };
}

export function mockYoutubeComments(videoId: string, q: string) {
  return { items: Array.from({ length: 12 }, (_, i) => ({ id: `${videoId}-c${i}-${Math.floor(rnd() * 1e6)}`, snippet: { totalReplyCount: Math.floor(rnd() * 5), topLevelComment: { snippet: { textDisplay: rnd() > 0.2 ? pick(SAMPLES) : "great video", authorDisplayName: `user${i}`, publishedAt: new Date().toISOString(), likeCount: Math.floor(rnd() * 40) } } } })) };
}
