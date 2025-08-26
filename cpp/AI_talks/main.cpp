#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <sstream>
#include <algorithm>
#include <map>
#include <regex>
#include <chrono>
#include <random>
#include <limits>
#include <iomanip>
#include <thread>
#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "../localpricesprovider/httplib.h"
#include "nlohmann/json.hpp"

using json = nlohmann::json;

// Levenshtein distance implementation
int levenshteinDistance(const std::string& s1, const std::string& s2) {
    const std::size_t len1 = s1.size(), len2 = s2.size();
    std::vector<std::vector<unsigned int>> d(len1 + 1, std::vector<unsigned int>(len2 + 1));

    d[0][0] = 0;
    for (unsigned int i = 1; i <= len1; ++i) d[i][0] = i;
    for (unsigned int i = 1; i <= len2; ++i) d[0][i] = i;

    for (unsigned int i = 1; i <= len1; ++i) {
        for (unsigned int j = 1; j <= len2; ++j) {
            d[i][j] = std::min({ d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (s1[i - 1] == s2[j - 1] ? 0 : 1) });
        }
    }
    return d[len1][len2];
}

// Function to find similar words
std::vector<std::pair<std::string, int>> findSimilarWords(const std::string& input_word, const std::vector<std::string>& keyword_list, int max_distance = 2) {
    std::vector<std::pair<std::string, int>> similar_words;
    for (const auto& keyword : keyword_list) {
        if (abs((int)input_word.length() - (int)keyword.length()) > max_distance) {
            continue;
        }
        int distance = levenshteinDistance(input_word, keyword);
        if (distance > 0 && distance <= max_distance) {
            similar_words.push_back({ keyword, distance });
        }
    }
    std::sort(similar_words.begin(), similar_words.end(), [](const std::pair<std::string, int>& a, const std::pair<std::string, int>& b) {
        return a.second < b.second;
        });
    return similar_words;
}

// Function to get confidence status
std::string getConfidenceStatus(double confidence_score) {
    if (confidence_score >= 1.0) {
        return "confident";
    }
    else {
        return "not confident";
    }
}

// Function to generate a unique request ID
std::string generateRequestID() {
    auto now = std::chrono::system_clock::now();
    auto epoch = now.time_since_epoch();
    auto value = std::chrono::duration_cast<std::chrono::milliseconds>(epoch);
    
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> distrib(1000, 9999);
    
    return std::to_string(value.count()) + "-" + std::to_string(distrib(gen));
}

// Function to classify the input based on keywords with fuzzy matching
json classifyUserInput(const std::string& user_text, const json& mode_keywords) {
    std::string user_text_lower = user_text;
    std::transform(user_text_lower.begin(), user_text_lower.end(), user_text_lower.begin(),
        [](unsigned char c) { return std::tolower(c); });

    std::stringstream ss(user_text_lower);
    std::string word;
    std::vector<std::string> words;
    while (ss >> word) {
        word.erase(std::remove_if(word.begin(), word.end(), ::ispunct), word.end());
        words.push_back(word);
    }

    std::map<std::string, double> mode_scores;
    std::map<std::string, json> matched_keywords;
    std::map<std::string, json> fuzzy_matches;
    std::vector<std::string> all_keywords;

    for (auto& el : mode_keywords.items()) {
        for (auto& keyword : el.value().items()) {
            all_keywords.push_back(keyword.key());
        }
    }

    // Exact matching
    for (auto& el : mode_keywords.items()) {
        for (auto& keyword : el.value().items()) {
            std::regex r("(^|\\s)" + keyword.key() + "(\\s|$)");
            if (std::regex_search(user_text_lower, r)) {
                mode_scores[el.key()] += keyword.value().get<double>();
                matched_keywords[el.key()].push_back({
                    {"keyword", keyword.key()},
                    {"confidence", keyword.value()},
                    {"match_type", "exact"}
                    });
            }
        }
    }

    // Fuzzy matching
    for (const auto& word : words) {
        if (word.length() < 3) continue;

        auto similar = findSimilarWords(word, all_keywords, 1);
        if (!similar.empty()) {
            std::string best_match = similar[0].first;
            int distance = similar[0].second;

            for (auto& el : mode_keywords.items()) {
                if (el.value().contains(best_match)) {
                    double confidence = el.value()[best_match].get<double>();
                    double adjusted_confidence = confidence * (1.0 - (distance * 0.5));
                    mode_scores[el.key()] += adjusted_confidence;
                    matched_keywords[el.key()].push_back({
                        {"keyword", best_match},
                        {"confidence", adjusted_confidence},
                        {"match_type", "fuzzy (original: " + word + ")"}
                        });
                    fuzzy_matches[el.key()].push_back({
                        {"original", word},
                        {"matched", best_match},
                        {"distance", distance}
                        });
                    break;
                }
            }
        }
    }

    if (mode_scores.empty()) {
        return {
            {"predicted_mode", "Unknown Mode"},
            {"confidence_score", 0.0},
            {"confidence_status", "not confident"},
            {"matched_keywords", json::array()},
            {"fuzzy_matches", json::array()}
        };
    }

    std::string best_mode = std::max_element(mode_scores.begin(), mode_scores.end(),
        [](const std::pair<const std::string, double>& a, const std::pair<const std::string, double>& b) {
            return a.second < b.second;
        })->first;

    double total_confidence = 0.0;
    if (matched_keywords.count(best_mode)) {
        for (const auto& item : matched_keywords[best_mode]) {
            total_confidence += item["confidence"].get<double>();
        }
    }

    return {
        {"predicted_mode", best_mode},
        {"confidence_score", total_confidence},
        {"confidence_status", getConfidenceStatus(total_confidence)},
        {"matched_keywords", matched_keywords.count(best_mode) ? matched_keywords[best_mode] : json::array()},
        {"fuzzy_matches", fuzzy_matches.count(best_mode) ? fuzzy_matches[best_mode] : json::array()}
    };
}

// Simple HTTPS GET helper
std::unique_ptr<httplib::SSLClient> make_client() {
    auto client = std::make_unique<httplib::SSLClient>("server2-production-3173.up.railway.app", 443);
    client->set_connection_timeout(5, 0);
    client->set_read_timeout(10, 0);
    client->set_write_timeout(10, 0);
    return client;
}

bool fetchPendingAI(std::vector<json>& out) {
    try {
        auto client = make_client();
        auto res = client->Get("/api/ai_req/pending");
        if (!res || res->status != 200) return false;
        out = json::parse(res->body).get<std::vector<json>>();
        return true;
    } catch (...) { return false; }
}

bool postAIResult(const std::string& request_id, const std::string& mode, const std::string& status) {
    try {
        auto client = make_client();
        json body = {
            {"request_id", request_id},
            {"mode", mode},
            {"status", status}
        };
        auto res = client->Post("/api/ai_req/result", body.dump(), "application/json");
        return res && res->status == 200;
    } catch (...) { return false; }
}

int main() {
    std::cout << "AI Classifier Worker Initialized" << std::endl;
    std::cout << "Polling server every 1s for AI requests..." << std::endl;

    json mode_keywords;
    std::ifstream f("detections.json");
    if (f) {
        f >> mode_keywords;
    } else {
        std::cerr << "Error loading detections.json" << std::endl;
        return 1;
    }

    while (true) {
        try {
            std::vector<json> pending;
            if (fetchPendingAI(pending) && !pending.empty()) {
                for (const auto& item : pending) {
                    // Expect { request_id, speech }
                    if (!item.contains("request_id") || !item.contains("speech")) continue;
                    const std::string request_id = item["request_id"].get<std::string>();
                    const std::string speech = item["speech"].get<std::string>();

                    // Classify
                    json classification_result = classifyUserInput(speech, mode_keywords);
                    const std::string mode = classification_result.value("predicted_mode", std::string("Unknown Mode"));
                    const std::string status = classification_result.value("confidence_status", std::string("not confident"));

                    // Post result back
                    if (postAIResult(request_id, mode, status)) {
                        std::cout << "Completed request " << request_id << " => mode='" << mode << "' status='" << status << "'" << std::endl;
                    } else {
                        std::cerr << "Failed to post result for request " << request_id << std::endl;
                    }
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "Worker loop error: " << e.what() << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    return 0;
}
