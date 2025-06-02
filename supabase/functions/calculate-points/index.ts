import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { PointCalculationRequest, PointCalculationResponse } from "../_shared/types.ts";
import { calculatePoints } from "../_shared/utils.ts";

// Create a Supabase client with the service role key
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  try {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    // Parse request body
    const requestData: PointCalculationRequest = await req.json();
    const { activationId, playerId, timeTakenMs, isCorrect } = requestData;

    if (!activationId || !playerId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Convert time taken to seconds
    const timeTakenSeconds = timeTakenMs / 1000;
    
    // Calculate points based on correctness and time taken
    const pointsAwarded = isCorrect ? calculatePoints(timeTakenSeconds) : 0;

    // Get current player data
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("score, stats")
      .eq("id", playerId)
      .single();
      
    if (playerError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch player data" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Calculate new score
    const currentScore = playerData.score || 0;
    const newScore = currentScore + pointsAwarded;
    
    // Get current stats or create default stats object
    let stats = playerData.stats || {
      totalPoints: 0,
      correctAnswers: 0, 
      totalAnswers: 0,
      averageResponseTimeMs: 0
    };
    
    // Calculate new stats
    const totalAnswers = stats.totalAnswers + 1;
    const correctAnswers = stats.correctAnswers + (isCorrect ? 1 : 0);
    const totalPoints = stats.totalPoints + pointsAwarded;
    
    // Calculate new average response time (weighted average)
    const prevTotalTime = stats.averageResponseTimeMs * stats.totalAnswers;
    const newTotalTime = prevTotalTime + timeTakenMs;
    const averageResponseTimeMs = totalAnswers > 0 ? newTotalTime / totalAnswers : 0;
    
    // Update player score and stats in database
    const { error: updateError } = await supabase
      .from("players")
      .update({ 
        score: newScore,
        stats: {
          totalPoints,
          correctAnswers,
          totalAnswers,
          averageResponseTimeMs
        }
      })
      .eq("id", playerId);
      
    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update player score" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Prepare response
    const response: PointCalculationResponse = {
      success: true,
      pointsAwarded,
      newScore,
      stats: {
        totalPoints,
        correctAnswers,
        totalAnswers,
        averageResponseTimeMs
      }
    };

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error calculating points:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});