import os
import io
import json
import base64
import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI(title="AI Nutrition Agent API")

# Enable Next.js Web UI Communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter Configuration
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
TARGET_MODEL = "google/gemini-2.5-flash:free"  # Free Tier option

class FoodItem(BaseModel):
    name: str
    estimated_weight_g: int
    calories: int
    protein_g: float
    carbs_g: float
    fats_g: float

class NutritionAnalysis(BaseModel):
    detected_items: List[FoodItem]
    total_calories: int
    total_protein_g: float
    total_carbs_g: float
    total_fats_g: float
    confidence_score: float
    disclaimer: str

SYSTEM_PROMPT = f"""
You are a precise AI Nutrition Agent. Analyze the provided food image context.
Identify all individual food items present, estimate their portions/weights in grams based on standard serving sizes, and provide their nutritional breakdown (calories, protein, carbs, fats).

You MUST respond strictly with a single, valid JSON object matching this schema structure:
{json.dumps(NutritionAnalysis.model_json_schema())}

Do not wrap your response in markdown formatting or code blocks. Output raw JSON only.
"""

@app.get("/")
def read_root():
    # Fixes the 404 error when visiting http://localhost:8000 directly
    return {"status": "online", "message": "AI Nutrition Agent API is running. Use POST /api/analyze-nutrition to parse food images."}

@app.post("/api/analyze-nutrition", response_model=NutritionAnalysis)
async def analyze_nutrition(file: UploadFile = File(...)):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY environment variable is not set.")
        
    try:
        contents = await file.read()
        base64_image = base64.b64encode(contents).decode('utf-8')
        mime_type = file.content_type or "image/jpeg"

        payload = {
            "model": TARGET_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this plate of food."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
                        }
                    ]
                }
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1
        }

        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "AI Nutrition Agent",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(OPENROUTER_URL, json=payload, headers=headers)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=f"OpenRouter Gateway Error: {response.text}")
            
            result_json = response.json()
            raw_content = result_json["choices"][0]["message"]["content"].strip()
            return NutritionAnalysis.model_validate_json(raw_content)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis engine failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
