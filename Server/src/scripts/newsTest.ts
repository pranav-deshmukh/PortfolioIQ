import path from "path";
import readline from "readline";
import dotenv from "dotenv";
import { fetchNewsData } from "../services/newsData-api.service";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function run() {
  try {
    console.log("\nEnter News Filters (press enter to skip any):\n");

    const q = await askQuestion("Query (q): ");
    const language = await askQuestion("Language (en): ");
    const country = await askQuestion("Country (us/in): ");
    const category = await askQuestion("Category (business): ");
    const size = await askQuestion("Size (number): ");

    const filters: Record<string, any> = {};

    if (q) filters.q = q;
    if (language) filters.language = language;
    if (country) filters.country = country;
    if (category) filters.category = category;
    if (size) filters.size = Number(size);

    // 🔥 fallback default
    if (Object.keys(filters).length === 0) {
      filters.q = "market";
      filters.language = "en";
      filters.size = 5;
    }

    const data = await fetchNewsData(filters);

    console.log("\nRESULT:\n");
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error("Error:", error);
  }
}

run();