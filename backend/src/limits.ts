/**
 * Result-size limits, kept small so research, claim building and chat answers stay fast.
 *
 * - SEARCH_RESULTS: links requested from / taken from ONE Context.dev search call.
 * - LINKS_PER_NODE: links (articles / sources) attached to one graph node (research event, claim).
 * - VECTOR_RESULTS / VECTOR_MAX: documents returned by a vector search (default / hard cap).
 */
export const SEARCH_RESULTS = 5;
export const LINKS_PER_NODE = 8;
export const VECTOR_RESULTS = 5;
export const VECTOR_MAX = 6;
