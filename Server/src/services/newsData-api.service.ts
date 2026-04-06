const BASE_URL = "https://newsdata.io/api/1/news";

function getApiKey(): string {
  const apiKey = process.env.NEWSDATA_API_KEY;

  if (!apiKey) {
    throw new Error("NEWSDATA_API_KEY is not set");
  }

  return apiKey;
}

export interface NewsDataFilters {
  q?: string;
  country?: string;
  category?: string;
  language?: string;
  domain?: string;
  size?: number;
  page?: string;
  prioritydomain?: string;
}

export async function fetchNewsData(filters: NewsDataFilters = {}) {
  const apiKey = getApiKey();

  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      ...Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined && v !== null)
      ),
    });

    const response = await fetch(`${BASE_URL}?${params.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NewsData API error: ${response.status} - ${errorText}`);
    }

    // 🔥 return EXACT raw response
    const data = await response.json();
    return data;

  } catch (error: any) {
    const tlsErrorCode = error?.cause?.code ?? error?.code;

    if (tlsErrorCode === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
      throw new Error(
        "TLS certificate verification failed while calling NewsData. This usually means your network or antivirus is intercepting HTTPS with a custom root certificate. Export that root CA as a PEM file and run Node with NODE_EXTRA_CA_CERTS=<path-to-ca.pem>. As a temporary local-only test, you can use NODE_TLS_REJECT_UNAUTHORIZED=0, but do not keep that in production."
      );
    }

    console.error("Error fetching news:", error.message);
    throw error;
  }
}