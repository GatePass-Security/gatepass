import axios from "axios";

// Shared client for all outbound HTTP. Keeping partner auth in one interceptor
// means individual tools never have to think about credentials.
export const http = axios.create({
  timeout: 8000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
});

http.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  config.headers["Authorization"] = `Bearer ${process.env.PARTNER_API_TOKEN}`;
  config.headers["User-Agent"] = "docs-agent/1.4";
  return config;
});

http.interceptors.response.use((response) => {
  if (response.status === 429) {
    throw new Error("partner rate limit reached");
  }
  return response;
});
