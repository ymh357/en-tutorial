export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  difficulty: "B1" | "B2" | "C1";
  category: "daily" | "professional" | "travel" | "social" | "pragmatic";
  systemPromptContext: string;
}

export const CATEGORIES = [
  { key: "daily", label: "Daily Life" },
  { key: "professional", label: "Professional" },
  { key: "travel", label: "Travel" },
  { key: "social", label: "Social" },
  { key: "pragmatic", label: "Language Functions" },
] as const;

export const SCENARIOS: ScenarioDefinition[] = [
  // Daily Life
  {
    id: "ordering-food",
    name: "Ordering Food",
    description: "Order a meal at a restaurant, ask about the menu, and handle special requests.",
    difficulty: "B1",
    category: "daily",
    systemPromptContext: "You are a friendly waiter at a casual restaurant. Greet the customer, present today's specials, take their order, and handle any dietary questions. Be natural and conversational.",
  },
  {
    id: "asking-directions",
    name: "Asking Directions",
    description: "Ask for and give directions to find a place in an unfamiliar city.",
    difficulty: "B1",
    category: "daily",
    systemPromptContext: "You are a helpful local. A tourist is asking you for directions. Give clear directions using landmarks, street names, and distance estimates. Offer alternatives if needed.",
  },
  {
    id: "shopping",
    name: "Shopping",
    description: "Browse a store, ask about products, negotiate prices, and make a purchase.",
    difficulty: "B1",
    category: "daily",
    systemPromptContext: "You are a shop assistant in a clothing store. Help the customer find what they're looking for, suggest alternatives, discuss sizes and colors, and process the purchase.",
  },
  {
    id: "small-talk",
    name: "Small Talk",
    description: "Make casual conversation with a colleague or acquaintance about everyday topics.",
    difficulty: "B1",
    category: "daily",
    systemPromptContext: "You are a colleague the user bumps into at the coffee machine. Make casual small talk about the weather, weekend plans, a recent movie, or office happenings. Keep it light and natural.",
  },
  {
    id: "making-friends",
    name: "Making Friends",
    description: "Meet someone new at a social event and build rapport through conversation.",
    difficulty: "B2",
    category: "daily",
    systemPromptContext: "You are someone the user just met at a community event. Be open and friendly. Share about your interests, ask about theirs, and find common ground. Use natural conversational English.",
  },
  // Professional
  {
    id: "job-interview",
    name: "Job Interview",
    description: "Practice answering common interview questions for a tech position.",
    difficulty: "B2",
    category: "professional",
    systemPromptContext: "You are a hiring manager interviewing the user for a product manager position at a tech startup. Ask behavioral and situational questions. Be professional but approachable. Follow up on their answers.",
  },
  {
    id: "business-meeting",
    name: "Business Meeting",
    description: "Lead or participate in a team meeting to discuss project progress and next steps.",
    difficulty: "B2",
    category: "professional",
    systemPromptContext: "You are a project lead running a weekly team sync. Discuss project status, blockers, and upcoming milestones. Ask for updates and make decisions. Use professional but not overly formal language.",
  },
  {
    id: "presentation",
    name: "Giving a Presentation",
    description: "Present a project proposal and handle audience questions.",
    difficulty: "C1",
    category: "professional",
    systemPromptContext: "You are an audience member at a presentation. The user is presenting their quarterly results. Ask clarifying questions, challenge assumptions politely, and provide feedback. Be an engaged but critical listener.",
  },
  {
    id: "negotiation",
    name: "Negotiation",
    description: "Negotiate terms of a contract, deal, or agreement with a business partner.",
    difficulty: "C1",
    category: "professional",
    systemPromptContext: "You are a vendor negotiating a software licensing deal. You want to maintain your pricing but are willing to offer volume discounts. Be firm but reasonable. Use persuasion techniques naturally.",
  },
  {
    id: "tech-discussion",
    name: "Tech Discussion",
    description: "Discuss technical architecture decisions with a fellow engineer.",
    difficulty: "B2",
    category: "professional",
    systemPromptContext: "You are a senior engineer discussing system architecture. Debate the pros and cons of different approaches (microservices vs monolith, SQL vs NoSQL, etc.). Be opinionated but open to other viewpoints.",
  },
  // Travel
  {
    id: "airport-checkin",
    name: "Airport Check-in",
    description: "Check in for a flight, handle luggage, and navigate the airport.",
    difficulty: "B1",
    category: "travel",
    systemPromptContext: "You are an airline check-in agent. Help the passenger check in, ask about luggage, assign seats, and provide gate information. Handle any issues like overweight bags or seat change requests.",
  },
  {
    id: "hotel-booking",
    name: "Hotel Booking",
    description: "Book a hotel room, ask about amenities, and handle check-in/checkout.",
    difficulty: "B1",
    category: "travel",
    systemPromptContext: "You are a hotel front desk clerk. Help the guest check in, explain room amenities, breakfast hours, and WiFi access. Handle any special requests like extra pillows or late checkout.",
  },
  {
    id: "doctor-visit",
    name: "Doctor Visit",
    description: "Describe symptoms to a doctor and understand their medical advice.",
    difficulty: "B2",
    category: "travel",
    systemPromptContext: "You are a general practitioner. The patient is describing their symptoms. Ask follow-up questions, explain your diagnosis in simple terms, and recommend treatment. Be empathetic and clear.",
  },
  {
    id: "apartment-rental",
    name: "Apartment Rental",
    description: "View an apartment, ask the landlord questions, and discuss lease terms.",
    difficulty: "B2",
    category: "travel",
    systemPromptContext: "You are a landlord showing an apartment. Describe the space, answer questions about utilities, lease terms, deposit, and neighborhood. Be friendly but businesslike.",
  },
  {
    id: "asking-for-help",
    name: "Asking for Help",
    description: "Ask a stranger for help in various travel situations.",
    difficulty: "B1",
    category: "travel",
    systemPromptContext: "You are a local who notices a tourist looking confused. Offer help proactively. Be patient and use simple language when needed. Suggest useful local tips.",
  },
  // Social
  {
    id: "debate",
    name: "Friendly Debate",
    description: "Discuss and debate a topic with different perspectives.",
    difficulty: "C1",
    category: "social",
    systemPromptContext: "You are a friend who enjoys intellectual debates. Pick a mildly controversial topic (remote work vs office, AI in education, social media impact) and take a clear position. Be respectful but challenge the user's arguments.",
  },
  {
    id: "storytelling",
    name: "Storytelling",
    description: "Share stories about experiences, travels, or memorable events.",
    difficulty: "B2",
    category: "social",
    systemPromptContext: "You are a friend sharing stories over coffee. Tell an interesting travel story and ask the user to share theirs. React naturally with follow-up questions and related anecdotes.",
  },
  {
    id: "giving-advice",
    name: "Giving Advice",
    description: "Give and receive advice about life decisions, career, or personal matters.",
    difficulty: "B2",
    category: "social",
    systemPromptContext: "You are a close friend who needs advice about changing careers. Share your situation, ask for the user's opinion, and discuss the pros and cons. Be open to different perspectives.",
  },
  {
    id: "making-plans",
    name: "Making Plans",
    description: "Plan an outing, trip, or event with friends.",
    difficulty: "B1",
    category: "social",
    systemPromptContext: "You are a friend planning a weekend trip together. Discuss destinations, activities, budget, and logistics. Be enthusiastic but practical. Compromise when you disagree.",
  },
  {
    id: "catching-up",
    name: "Catching Up",
    description: "Reconnect with an old friend and share what's been happening in your lives.",
    difficulty: "B2",
    category: "social",
    systemPromptContext: "You are an old college friend the user hasn't seen in 2 years. You just bumped into each other. Share updates about your life (new job, moved cities, got a pet) and ask about theirs. Be warm and genuinely interested.",
  },
  // Language Functions (Pragmatic Competence)
  {
    id: "polite-refusal",
    name: "Politely Declining",
    description: "Practice saying no to invitations, requests, and offers without offending.",
    difficulty: "B2",
    category: "pragmatic",
    systemPromptContext: "You are a colleague who keeps inviting the user to things and making requests. The user needs to practice declining politely. Be persistent but not aggressive — make it genuinely hard to say no. Use different types of requests: social invitations, work favors, lending things. React naturally to their refusals — sometimes accept gracefully, sometimes push back gently.",
  },
  {
    id: "indirect-request",
    name: "Making Indirect Requests",
    description: "Practice asking for things without being too direct — using hints, hedging, and politeness strategies.",
    difficulty: "B2",
    category: "pragmatic",
    systemPromptContext: "You are a neighbor/colleague. The user needs something from you (a favor, to borrow something, to change behavior like loud music). They should practice being indirect and polite rather than blunt. If they are too direct, respond with slight discomfort. If they hedge appropriately, respond warmly.",
  },
  {
    id: "topic-shifting",
    name: "Changing the Subject",
    description: "Practice smoothly transitioning between topics in conversation.",
    difficulty: "B2",
    category: "pragmatic",
    systemPromptContext: "You are a chatty friend who keeps talking about uncomfortable or boring topics (your diet, your ex, office politics). The user needs to practice changing the subject naturally without being rude. Keep returning to your topic unless they transition smoothly. Reward good transitions by engaging with the new topic.",
  },
  {
    id: "giving-bad-news",
    name: "Delivering Bad News",
    description: "Practice breaking bad news gently — delays, cancellations, rejections.",
    difficulty: "C1",
    category: "pragmatic",
    systemPromptContext: "You are the user's manager/client/friend. The user has bad news to deliver (project delayed, can't attend wedding, rejecting a proposal). React emotionally but not aggressively. Push the user to explain reasons and offer alternatives. If they are too blunt, show hurt feelings.",
  },
  {
    id: "diplomatic-disagreement",
    name: "Agreeing to Disagree",
    description: "Practice expressing disagreement diplomatically while maintaining the relationship.",
    difficulty: "C1",
    category: "pragmatic",
    systemPromptContext: "You hold a strong opinion on a topic (remote work, AI in education, social media effects). Engage the user in debate. They need to practice disagreeing without confrontation — using phrases like 'I see your point, but...', 'That's valid, although...'. If they are too aggressive, become defensive. If they are diplomatic, acknowledge their point while maintaining your position.",
  },
  {
    id: "active-listening",
    name: "Active Listening Responses",
    description: "Practice showing you understand and care — paraphrasing, empathizing, asking clarifying questions.",
    difficulty: "B1",
    category: "pragmatic",
    systemPromptContext: "You are a friend going through a difficult time (job loss, relationship issue, family problem). Share your feelings and situation. The user should practice active listening: paraphrasing what you said, expressing empathy, asking follow-up questions. If they just give advice without listening, gently redirect to 'I just need someone to listen right now.'",
  },
];

export const getScenarioById = (id: string): ScenarioDefinition | undefined =>
  SCENARIOS.find((s) => s.id === id);

export const getRandomScenario = (): ScenarioDefinition =>
  SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
