// companimal.co.uk page inventory, read from the live sitemap on 16 Nov 2026.
// Used only when the live sitemap can't be read (the site's bot protection can block it) and for local
// testing. The live read every Monday replaces it. Sale and stud breed hubs are derived from the breed list.
export const SNAPSHOT_DATE = "2026-11-16";

// path | title (without " | Companimal") | H1
export const SNAPSHOT_PAGES: [string, string, string][] = [
  ["/", "Puppies for Sale UK from Verified Breeders", "Puppies for sale from breeders verified by a human, not an algorithm."],
  ["/breeders", "Licensed Dog Breeders Directory", "Licensed Dog Breeders"],
  ["/breeds", "Dog Breeds Guide: Find the Breed That Fits Your Life", "Find the breed that fits your life."],
  ["/lucys-law", "Lucy's Law UK: Puppy Sales Rules Explained", "Lucy's Law explained: what it means for buying and selling puppies"],
  ["/puppy-advice/", "Puppy Advice: UK Guides to Raising Your Puppy", "Puppy advice: raising, training and caring for your puppy"],
  ["/puppy-advice/adolescent-dogs", "Teenage Dog: Canine Adolescence Explained", "Teenage dog: what to expect from canine adolescence and how to cope"],
  ["/puppy-advice/best-dog-insurance-uk", "Best Dog Insurance UK 2026: 8 Pet Insurance Providers Compared", "Best Dog Insurance UK 2026: 8 Pet Insurance Providers Compared"],
  ["/puppy-advice/bringing-a-puppy-home", "Bringing a Puppy Home: First Night and Week", "Bringing a Puppy Home: Collection Day, First Night and First Week"],
  ["/puppy-advice/crate-training-a-puppy", "How to Crate Train a Puppy, Day and Night", "Crate Training a Puppy: A Step-by-Step Guide for Day and Night"],
  ["/puppy-advice/how-long-are-dogs-pregnant", "How Long Are Dogs Pregnant? Dog Pregnancy Guide", "How Long Are Dogs Pregnant? Signs of Pregnancy in Dogs, Week by Week"],
  ["/puppy-advice/how-long-to-walk-a-puppy", "How Long to Walk a Puppy: Age and Size Guide", "How Long to Walk a Puppy: A Guide by Age, Size and Stage"],
  ["/puppy-advice/how-to-breed-dogs", "Breeding Dogs: A Responsible UK Guide", "Breeding Dogs: A Responsible UK Guide for First-Time Breeders"],
  ["/puppy-advice/how-to-sell-puppies", "How to Sell Puppies Safely in the UK", "How to Sell Puppies in the UK: Safely, Responsibly and to Happy Forever Homes"],
  ["/puppy-advice/how-to-spot-a-puppy-scam", "How to Spot a Puppy Scam Online: UK Red Flags", "How to Spot a Puppy Scam Online: Red Flags, Checks and What to Do If You're Scammed"],
  ["/puppy-advice/how-to-toilet-train-a-puppy", "How to toilet train a puppy: a step-by-step UK guide", "How to toilet train a puppy: a step-by-step UK guide"],
  ["/puppy-advice/male-or-female-dog", "Male or Female Dog? An Honest Comparison", "Male or Female Dog? An Honest Guide to Choosing Your Puppy"],
  ["/puppy-advice/microchipping-puppies", "Microchipping Puppies: UK Law for Breeders", "Microchipping Puppies: The UK Law for Breeders and Buyers"],
  ["/puppy-advice/new-puppy-checklist", "Puppy Essentials: New Puppy Checklist", "Puppy Essentials: The New Puppy Checklist for Everything You Need"],
  ["/puppy-advice/parvo-in-puppies", "Parvo Symptoms in Puppies and How to Prevent It", "Parvo Symptoms in Puppies: What Parvo Is and How to Protect Your Puppy"],
  ["/puppy-advice/puppy-biting", "How to Stop Puppy Biting and Nipping", "How to Stop Puppy Biting and Nipping: Why Puppies Bite and When It Stops"],
  ["/puppy-advice/puppy-breathing-fast", "Puppy Breathing Fast When Sleeping: Normal?", "Puppy breathing fast when sleeping: what is normal and when to worry"],
  ["/puppy-advice/puppy-contract", "Puppy Contract: What It Covers and What to Sign", "Puppy Contract: What It Covers, What to Sign and the Red Flags"],
  ["/puppy-advice/puppy-development-stages", "Puppy Development Stages: Week by Week Guide", "Puppy Development Stages: An Age-by-Age Guide From Birth to Adulthood"],
  ["/puppy-advice/puppy-diarrhoea", "Puppy Diarrhoea: Causes and When to Call a Vet", "Puppy Diarrhoea: Causes, Warning Signs and When to Call the Vet"],
  ["/puppy-advice/puppy-feeding-guide", "How Much to Feed a Puppy: Feeding Guide", "How Much to Feed a Puppy: A Puppy Feeding Guide by Age"],
  ["/puppy-advice/puppy-flea-treatment", "Puppy Flea Treatment: Ages, Types and How Often", "Puppy Flea Treatment: When to Start, What to Use and How Often"],
  ["/puppy-advice/puppy-hiccups", "Puppy Hiccups: Causes, Help and When to Worry", "Puppy Hiccups: Why They Happen and When to Worry"],
  ["/puppy-advice/puppy-playpen", "Puppy Playpen: How to Choose and Use a Dog Pen", "Puppy Playpen Guide: How to Choose, Set Up and Use One Safely"],
  ["/puppy-advice/puppy-recall-training", "Puppy Recall Training: A Step-by-Step Guide", "Puppy Recall Training: How to Teach Your Puppy to Come When Called"],
  ["/puppy-advice/puppy-separation-anxiety", "Puppy Separation Anxiety: Teach Calm Alone Time", "Puppy separation anxiety: how to teach your puppy to be left alone"],
  ["/puppy-advice/puppy-sleep", "How Long Do Puppies Sleep? Puppy Sleep by Age", "How Long Do Puppies Sleep? Hours by Age and a Puppy Sleep Schedule"],
  ["/puppy-advice/puppy-socialisation", "Puppy Socialisation: Guide and Checklist", "Puppy Socialisation: How to Socialise a Puppy, Plus a Checklist"],
  ["/puppy-advice/puppy-teething", "When Do Puppies Lose Their Teeth? Ages and Help", "When Do Puppies Lose Their Teeth? A Guide to Puppy Teething"],
  ["/puppy-advice/puppy-toys", "Puppy Toys: Best Chew Toys and Soft Toys Guide", "Puppy Toys: How to Choose the Best, Safest Toys for Your Dog"],
  ["/puppy-advice/puppy-training", "Puppy Training: The Complete UK Guide", "Puppy Training: The Complete UK Guide From 8 Weeks to Adolescence"],
  ["/puppy-advice/puppy-vaccinations", "Puppy Vaccinations UK: Schedule and Boosters", "Puppy Vaccinations: The UK Schedule, Boosters and When Your Puppy Can Go Out"],
  ["/puppy-advice/weaning-puppies", "Weaning Puppies: A Week-by-Week Guide", "Weaning Puppies: A Week-by-Week Guide for Breeders"],
  ["/puppy-advice/when-can-puppies-go-outside", "When Can Puppies Go Outside? A UK Guide", "When Can Puppies Go Outside? The Garden, First Walks and Vaccinations"],
  ["/puppy-advice/when-can-puppies-leave-their-mum", "When Can Puppies Leave Their Mum? UK Rules", "When Can Puppies Leave Their Mum? UK Rules and Why 8 Weeks Matters"],
  ["/puppy-advice/when-to-neuter-a-dog", "When to Neuter a Dog: Best Age to Spay", "When to Neuter a Dog: The Best Age for Spaying and Castration in the UK"],
  ["/puppy-advice/why-do-puppies-cry", "Puppy Crying at Night or When Alone: What to Do", "Puppy crying: why puppies cry at night and how to help them settle"],
  ["/puppy-advice/worming-puppies", "Worming Puppies: Schedule, Signs and Lungworm", "Worming Puppies: When to Start, How Often and What to Ask the Breeder"],
  ["/sale/puppies/", "Puppies for Sale", "Find your perfect puppy"],
  ["/sell-my-puppies", "Sell Puppies Online UK: Advertise Your Litter", "Sell puppies online to serious UK buyers, not time-wasters."],
  ["/statistics/", "Statistics", "Statistics"],
  ["/statistics/cost-of-owning-a-dog-uk", "Cost of Owning a Dog UK 2026", "Cost of Owning a Dog UK 2026: At Least £828 a Year, and Vet Prices Up 86% Since 2015"],
  ["/statistics/crossbreed-and-designer-dog-statistics", "Crossbreed and Designer Dog Statistics UK 2026", "Crossbreed and Designer Dog Statistics UK 2026: Between 14% and 42% of Dogs Are Crossbreeds"],
  ["/statistics/dog-ownership-by-region", "Dog Ownership by Region UK 2026", "Dog Ownership by Region Statistics UK 2026: Most Dogs per Person in the North East and Wales"],
  ["/statistics/flat-faced-breed-health-statistics", "Flat-Faced Dog Health Statistics UK 2026", "Flat-Faced Dog Breed Health Statistics UK 2026: Breathing, Lifespan and Costs"],
  ["/statistics/life-expectancy-of-dogs", "Dog Life Expectancy Statistics UK 2026", "Dog Life Expectancy Statistics UK 2026: Between 11.2 and 12.5 Years"],
  ["/statistics/most-expensive-dog-breeds-uk", "Most Expensive Dog Breeds UK 2026", "Most Expensive Dog Breeds UK 2026: The Bernedoodle Leads at £2,305"],
  ["/statistics/most-popular-dog-breeds-uk", "Most Popular Dog Breeds in the UK 2026", "Most Popular Dog Breeds in the UK 2026: The Labrador Is Still Top Dog"],
  ["/statistics/puppy-price-statistics-uk", "Puppy Price Statistics UK 2026", "Puppy Price Statistics UK 2026: Up 16% in a Year, Back to 2019 in Real Terms"],
  ["/statistics/rising-and-declining-dog-breeds", "Dog Breeds Declining in Popularity UK (2026)", "Dog Breeds Declining in Popularity UK 2026: Which Are Falling and Which Are Rising"],
  ["/statistics/uk-dog-ownership-statistics", "UK Dog Ownership Statistics 2026", "UK Dog Ownership Statistics 2026: Between 10.2 and 15.5 Million Dogs"],
  ["/statistics/who-owns-dogs-uk-owner-demographics", "Who Owns Dogs in the UK? Owner Statistics 2026", "Dog Owner Statistics UK 2026: 11.6 Million Adults Live With a Dog"],
  ["/stud/dogs/", "Stud Dogs", "Find a stud dog"],
];

// Every /breeds/<slug>/ page (311)
export const SNAPSHOT_BREEDS = `affenpinscher afghan-hound airedale-terrier akita alaskan-klee-kai alaskan-malamute american-bulldog american-cocker-spaniel
american-hairless-terrier american-staffordshire-terrier anatolian-shepherd-dog aussiedoodle australian-cattle-dog australian-shepherd australian-silky-terrier
australian-terrier azawakh basenji basset-bleu-de-gascogne basset-fauve-de-bretagne basset-griffon-vendeen-grand basset-griffon-vendeen-petit basset-hound
bavarian-mountain-hound beagle beaglier bearded-collie beauce-shepherd bedlington-terrier belgian-shepherd-dog-groenendael belgian-shepherd-dog-laekenois
belgian-shepherd-dog-malinois belgian-shepherd-dog-tervueren bergamasco bernedoodle bernese-mountain-dog bichon-frise biewer-terrier bloodhound blue-lacy
boerboel bolognese borador border-collie border-terrier borderjack bordoodle borzoi boston-terrier bouvier-des-flandres boxador boxer bracco-italiano briard
brittany broholmer bull-terrier bull-terrier-miniature bulldog bullmastiff cairn-terrier canaan-dog canadian-eskimo-dog cane-corso catahoula-leopard-dog
catalan-sheepdog caucasian-shepherd-dog cavachon cavalier-king-charles-spaniel cavapoo cavapoochon central-asian-shepherd-dog cesky-terrier
chesapeake-bay-retriever chihuahua-long-coat chihuahua-smooth-coat chinese-crested chiweenie chorkie chow-chow chug cirneco-delletna clumber-spaniel cockapoo
cocker-spaniel cockerpoo collie-rough collie-smooth corgi-cardigan corgi-pembroke corgi-poo corgidor coton-de-tulear curly-coated-retriever
dachshund-long-haired dachshund-miniature-long-haired dachshund-miniature-smooth-haired dachshund-miniature-wire-haired dachshund-smooth-haired
dachshund-wire-haired dalmador dalmatian dandie-dinmont-terrier deerhound dobermann dogue-de-bordeaux dorgi doxiepoo dutch-shepherd-dog english-setter
english-springer-spaniel english-toy-terrier-black-tan estrela-mountain-dog eurasier f1-cockapoo f1b-cockapoo field-spaniel finnish-lapphund finnish-spitz
flat-coated-retriever fox-terrier-smooth fox-terrier-wire foxhound french-bulldog frenchton frug german-longhaired-pointer german-pinscher german-shepherd-dog
german-shorthaired-pointer german-spitz-klein german-spitz-mittel german-wirehaired-pointer giant-schnauzer glen-of-imaal-terrier goberian goldador
golden-retriever goldendoodle gordon-setter grand-bleu-de-gascogne great-dane greenland-dog greyhound griffon-bruxellois hamiltonstovare harrier havanese
havapoo hokkaido hovawart hungarian-kuvasz hungarian-puli hungarian-vizsla hungarian-wire-haired-vizsla huskamute ibizan-hound irish-red-and-white-setter
irish-setter irish-terrier irish-water-spaniel irish-wolfhound italian-greyhound italian-spinone jack-russell-terrier jackapoo japanese-akita-inu japanese-chin
japanese-shiba-inu japanese-spitz jug kai keeshond kerry-blue-terrier king-charles-spaniel kishu komondor kooikerhondje korean-jindo kromfohrlander labradoodle
labrador-retriever labrottie labsky lagotto-romagnolo lakeland-terrier lancashire-heeler large-munsterlander leonberger lhasa-apso lhasapoo longdog lowchen
lurcher maltese maltese-shih-tzu maltichon maltipoo manchester-terrier maremma-sheepdog mastiff mexican-hairless miniature-goldendoodle miniature-labradoodle
miniature-pinscher miniature-schnauzer mixed-breed mixed-breed-large mixed-breed-small morkie mudi neapolitan-mastiff newfoundland norfolk-terrier
norrbottenspets northern-inuit-dog norwegian-buhund norwegian-elkhound norwegian-lundehund norwich-terrier nova-scotia-duck-tolling-retriever
old-english-sheepdog otterhound papillon parson-russell-terrier peekapoo pekingese peruvian-hairless pharaoh-hound picardy-sheepdog pointer
polish-lowland-sheepdog pomchi pomeranian pomsky poochon poodle-miniature poodle-standard poodle-toy poogle portuguese-podengo portuguese-pointer
portuguese-water-dog presa-canario pug pugalier puggle pyrenean-mastiff pyrenean-mountain-dog pyrenean-sheepdog-long-haired rescue-mix rhodesian-ridgeback
rottador rottweiler russian-black-terrier russian-toy saluki samoyed schipperke schnauzer schnoodle scottish-terrier sealyham-terrier segugio-italiano
shar-pei sheepadoodle shepsky shetland-sheepdog shichon shih-tzu shihpoo shiloh-shepherd shorkie siberian-husky skye-terrier sloughi small-munsterlander
soft-coated-wheaten-terrier spanish-water-dog springador sprockapoo sprocker-spaniel st-bernard staffordshire-bull-terrier staffy-cross sussex-spaniel
swedish-lapphund swedish-vallhund tamaskan thai-ridgeback tibetan-mastiff tibetan-spaniel tibetan-terrier toy-cavapoo transylvanian-hound unknown-breed
utonagan weimaraner welsh-springer-spaniel welsh-terrier west-highland-white-terrier westiepoo whippet white-swiss-shepherd-dog whoodle
wirehaired-pointing-griffon yakutian-laika yorkiechon yorkipoo yorkshire-terrier zuchon`.split(/\s+/).filter(Boolean);
