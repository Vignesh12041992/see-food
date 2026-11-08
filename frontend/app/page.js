'use client';

import React, { useState } from 'react';
import { Upload, Sparkles, AlertCircle, Apple } from 'lucide-react';

export default function Home() {
    const = useState(null);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const handleImageChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImage(file);
            setPreview(URL.createObjectURL(file));
            setResult(null);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!image) return;
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', image);

        try {
            const response = await fetch('http://localhost:8000/api/analyze-nutrition', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error: ${errText}`);
            }
            
            const data = await response.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to backend server.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-8">
                
                {/* Header Element */}
                <div className="text-center space-y-2">
                    <div className="inline-flex p-3 bg-emerald-100 text-emerald-700 rounded-2xl mb-2">
                        <Apple size={32} />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight">AI Nutrition Agent</h1>
                    <p className="text-slate-500 max-w-md mx-auto">Upload a photo of your food to instantly break down caloric payload and macros.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 items-start">
                    
                    {/* Card Left: Interactive Media Handler */}
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition overflow-hidden relative">
                            {preview ? (
                                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="flex flex-col items-center justify-center text-center p-4">
                                    <Upload className="w-10 h-10 text-slate-400 mb-3" />
                                    <p className="text-sm font-medium text-slate-600">Select or drop food picture</p>
                                    <p className="text-xs text-slate-400 mt-1">PNG, JPG or WEBP</p>
                                </div>
                            )}
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                        </label>

                        <button
                            onClick={handleUpload}
                            disabled={!image || loading}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-2xl transition flex items-center justify-center gap-2 shadow-sm"
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Sparkles size={18} />
                                    Analyze Food Plate
                                </>
                            )}
                        </button>
                        {error && (
                            <div className="text-red-700 bg-red-50 text-sm p-4 rounded-xl flex gap-2 items-center border border-red-100">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>

                    {/* Card Right: Live Dashboard Feed */}
                    <div className="space-y-6">
                        {result ? (
                            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                                
                                {/* Total Energetics Summary */}
                                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-6 text-center">
                                    <span className="text-xs font-bold tracking-wider text-emerald-800 uppercase">Estimated Total Load</span>
                                    <div className="text-5xl font-black text-emerald-900 mt-1">
                                        {result.total_calories} <span className="text-xl font-normal text-emerald-700">kcal</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-2">Model Certainty: {(result.confidence_score * 100).toFixed(0)}%</div>
                                </div>

                                {/* Micro Distribution Metrics */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl text-center">
                                        <div className="text-xs text-amber-700 font-semibold mb-0.5">Protein</div>
                                        <div className="text-lg font-bold text-amber-900">{result.total_protein_g}g</div>
                                    </div>
                                    <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl text-center">
                                        <div className="text-xs text-blue-700 font-semibold mb-0.5">Carbs</div>
                                        <div className="text-lg font-bold text-blue-900">{result.total_carbs_g}g</div>
                                    </div>
                                    <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-center">
                                        <div className="text-xs text-rose-700 font-semibold mb-0.5">Fats</div>
                                        <div className="text-lg font-bold text-rose-900">{result.total_fats_g}g</div>
                                    </div>
                                </div>

                                {/* Granular Items Table */}
                                <div className="space-y-3">
                                    <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wide">Detected Ingredients</h3>
                                    <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                                        {result.detected_items?.map((item, index) => (
                                            <div key={index} className="p-4 bg-slate-50/50 flex justify-between items-center text-sm">
                                                <div>
                                                    <div className="font-semibold text-slate-900">{item.name}</div>
                                                    <div className="text-xs text-slate-400">{item.estimated_weight_g}g portion</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold text-slate-900">{item.calories} kcal</div>
                                                    <div className="text-xs text-slate-400 font-mono">P:{item.protein_g}g C:{item.carbs_g}g F:{item.fats_g}g</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-slate-100">{result.disclaimer}</p>
                            </div>
                        ) : (
                            <div className="h-64 border-2 border-dashed border-slate-200 rounded-3xl flex items-center justify-center text-center p-6 text-slate-400 bg-white">
                                {!loading ? "Select a plate photo and hit analyze to review tracking statistics." : "AI backend is decoding food ingredients..."}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </main>
    );
}
