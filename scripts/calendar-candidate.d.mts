type AnnualRow = {date:string;title:string;description:string};
export function classifyAnnualRows(payload: unknown): {closed:AnnualRow[];open:AnnualRow[];needsReview:AnnualRow[]};
export function createNoticeCandidate(input:{url:string;text:string;retrievedAt:string}):Promise<{status:'needs_human_approval';scope:'exchange'|'unverified';market:'TW';closureDate:string|null;autoPublish:false;sha256:string}>;
