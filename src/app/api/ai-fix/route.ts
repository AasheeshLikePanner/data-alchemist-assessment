import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-001",
  tools: [
    {
      codeExecution: {},
    },
  ],
});


export async function POST(req: Request): Promise<Response> {

  const data = await req.json();
  const prompt = data.text;

  const result = await model.generateContent(prompt);

  return new Response(
    JSON.stringify({
      summary: result.response.text(),
    }),
  );
}