#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h"
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include "nlohmann/json.hpp"
#include <direct.h>
#include <Windows.h>
#include <filesystem>
#include <iomanip>

namespace fs = std::filesystem;
using json = nlohmann::json;

// Configuration
const std::string SERVER_BASE_URL = "server2-production-3f9a.up.railway.app";
const int SERVER_PORT = 443;
const std::string DOWNLOAD_DIR = "downloads";
const std::string PYTHON_APP = "pyApp\\translation.py";
const int CHECK_INTERVAL = 3;

// Add headers to requests
httplib::Headers GetDefaultHeaders() {
    return {
        {"Accept", "application/json"},
        {"Content-Type", "application/json"},
        {"User-Agent", "TranslationWorker/1.0"}
    };
}

bool DownloadFile(const std::string& url, const std::string& outputPath) {
    httplib::SSLClient cli(SERVER_BASE_URL, SERVER_PORT);
    cli.enable_server_certificate_verification(false);
    cli.set_connection_timeout(30);
    cli.set_read_timeout(30);
    
    // Get headers with potential authorization
    auto headers = GetDefaultHeaders();
    // If you need authentication, add it here:
    // headers.emplace("Authorization", "Bearer YOUR_TOKEN");
    
    // Construct the full URL if it's not already complete
    std::string fullUrl = url;
    if (url.find("http") != 0 && url[0] == '/') {
        fullUrl = "https://" + SERVER_BASE_URL + url;
    }
    
    // Extract just the path for the HTTP request
    std::string path;
    if (fullUrl.find("http") == 0) {
        size_t base_pos = fullUrl.find(SERVER_BASE_URL);
        if (base_pos != std::string::npos) {
            path = fullUrl.substr(base_pos + SERVER_BASE_URL.length());
        } else {
            path = fullUrl.substr(fullUrl.find("/", 8)); // Skip http:// or https://
        }
    } else {
        path = fullUrl;
    }
    
    std::cout << "Attempting to download from: " << path << std::endl;
    
    auto res = cli.Get(path, headers);
    
    if (res) {
        std::cout << "Download response status: " << res->status << std::endl;
        if (res->status == 200) {
            std::ofstream ofs(outputPath, std::ios::binary);
            if (!ofs) {
                std::cerr << "Failed to create file: " << outputPath << std::endl;
                return false;
            }
            ofs << res->body;
            return true;
        }
    }
    
    std::cerr << "Download failed. Status: " << (res ? res->status : 0) 
              << ", Error: " << (res ? res->body : "No response") << std::endl;
    return false;
}

json HttpGetJson(const std::string& path) {
    httplib::SSLClient cli(SERVER_BASE_URL, SERVER_PORT);
    cli.enable_server_certificate_verification(false);
    cli.set_connection_timeout(30);
    cli.set_read_timeout(30);
    
    std::cout << "GET Request to: " << path << std::endl;
    
    auto res = cli.Get(path, GetDefaultHeaders());
    
    if (res) {
        std::cout << "Response status: " << res->status << std::endl;
        if (res->status == 200) {
            try {
                return json::parse(res->body);
            } catch (const std::exception& e) {
                std::cerr << "JSON parse error: " << e.what() << std::endl;
            }
        } else {
            std::cerr << "Server error - Status: " << res->status 
                      << ", Body: " << res->body << std::endl;
        }
    } else {
        auto err = res.error();
        std::cerr << "HTTP error: " << httplib::to_string(err) << std::endl;
    }
    return nullptr;
}

bool HttpPostJson(const std::string& path, const json& data) {
    httplib::SSLClient cli(SERVER_BASE_URL, SERVER_PORT);
    cli.enable_server_certificate_verification(false);
    
    // Very short timeouts since we don't need the response
    cli.set_connection_timeout(5);  // 5 seconds to connect
    cli.set_write_timeout(5);       // 5 seconds to send data
    cli.set_read_timeout(1);        // Minimal time to wait for response
    
    std::string requestBody = data.dump(-1, ' ', false, json::error_handler_t::replace);
    std::cout << "POSTing data to: " << path << std::endl;
    
    auto res = cli.Post(path, GetDefaultHeaders(), requestBody, "application/json; charset=utf-8");
    
    // Consider the request successful if:
    // 1. We got any response (even if we don't check it), OR
    // 2. The data was definitely sent (even if we didn't get a response)
    if (res || 
        (res.error() == httplib::Error::Success) ||
        (res.error() == httplib::Error::Read)) {
        std::cout << "Request successfully sent to server" << std::endl;
        return true;
    }
    
    std::cerr << "HTTP POST failed: " << httplib::to_string(res.error()) << std::endl;
    return false;
}

std::string RunPythonScript(const std::string& scriptPath, const std::string& inputFile) {
    // Get the full path to the Python script
    fs::path fullScriptPath = fs::absolute(scriptPath);
    
    // Verify the Python script exists
    if (!fs::exists(fullScriptPath)) {
        std::cerr << "Error: Python script not found at " << fullScriptPath << std::endl;
        return R"({"error": "Python script not found"})";
    }

    // Verify the input file exists
    if (!fs::exists(inputFile)) {
        std::cerr << "Error: Input file not found at " << inputFile << std::endl;
        return R"({"error": "Input file not found"})";
    }

    std::string command = "py \"" + fullScriptPath.string() + "\" \"" + inputFile + "\"";
    std::array<char, 128> buffer;
    std::string result;

    std::cout << "Executing: " << command << std::endl;

    FILE* pipe = _popen(command.c_str(), "r");
    if (!pipe) {
        std::cerr << "Error: Failed to execute Python script" << std::endl;
        return R"({"error": "Failed to execute Python script"})";
    }

    while (fgets(buffer.data(), buffer.size(), pipe) != nullptr) {
        result += buffer.data();
    }

    int exitCode = _pclose(pipe);
    if (exitCode != 0) {
        std::cerr << "Python script exited with code: " << exitCode << std::endl;
        return R"({"error": "Python script execution failed"})";
    }

    std::cout << "Python output: " << result << std::endl;
    return result;
}

void ProcessRequest(const json& request) {
    std::string filePath;
    try {
        std::string requestId = request["request_id"];
        std::string inputType = request["input_type"];
        
        std::cout << "\nProcessing request ID: " << requestId << std::endl;
        std::cout << "Input type: " << inputType << std::endl;

        if (!fs::exists(DOWNLOAD_DIR)) {
            fs::create_directory(DOWNLOAD_DIR);
        }

        if (inputType == "raw_text") {
            filePath = DOWNLOAD_DIR + "/" + requestId + ".json";
            json textData;
            textData["arabic_text"] = request["arabic_text"].get<std::string>();
            std::ofstream(filePath) << textData.dump();
        } 
        else if (inputType == "json_file" || inputType == "image_file") {
            std::string ext = (inputType == "json_file") ? ".json" : 
                             (inputType == "image_file") ? ".png" : ".jpg";
            filePath = DOWNLOAD_DIR + "/" + requestId + ext;
            
            if (!request.contains("file_url") || request["file_url"].is_null()) {
                throw std::runtime_error("No file_url provided for " + inputType + " request");
            }
            
            std::string fileUrl = request["file_url"];
            std::cout << "File URL from server: " << fileUrl << std::endl;
            
            if (!DownloadFile(fileUrl, filePath)) {
                throw std::runtime_error("Failed to download " + inputType + " file");
            }
        }
        else {
            throw std::runtime_error("Unknown input type: " + inputType);
        }

        std::cout << "Input file: " << filePath << std::endl;
        
        // 1. Run Python script to process the file
        std::string pythonOutput = RunPythonScript(PYTHON_APP, filePath);
        
        // 2. Parse the Python script output
        json result;
        try {
            result = json::parse(pythonOutput);
            
            if (result.contains("error") && !result["error"].get<std::string>().empty()) {
                throw std::runtime_error("Translation error: " + result["error"].get<std::string>());
            }
        } catch (const std::exception& e) {
            std::cerr << "Error parsing Python output: " << e.what() 
                      << "\nRaw output: " << pythonOutput << std::endl;
            throw;
        }

        // 3. Send results back to server
        if (result.contains("english_translation")) {
            json completeData = {
                {"request_id", requestId},
                {"arabic_text", result["arabic_text"].get<std::string>()},
                {"english_translation", result["english_translation"].get<std::string>()},
                {"status", "completed"}
            };

            if (!HttpPostJson("/api/translate/complete", completeData)) {
                throw std::runtime_error("Failed to send completion to server");
            }
            std::cout << "Successfully processed and sent results for request: " << requestId << std::endl;
        }
        
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        if (!filePath.empty() && fs::exists(filePath)) {
            fs::remove(filePath);
        }
        throw;
    }
    
    // Clean up
    if (!filePath.empty() && fs::exists(filePath)) {
        fs::remove(filePath);
    }
}

int main() {
    std::cout << "Starting Translation Processor (v1.7 - Robust Polling)" << std::endl;
    std::cout << "Server: " << SERVER_BASE_URL << ":" << SERVER_PORT << std::endl;
    std::cout << "Check interval: " << CHECK_INTERVAL << " seconds" << std::endl;

    if (!fs::exists(DOWNLOAD_DIR)) {
        fs::create_directory(DOWNLOAD_DIR);
    }

    int consecutive_errors = 0;
    const int MAX_CONSECUTIVE_ERRORS = 5;

    while (true) {
        try {
            auto cycle_start = std::chrono::steady_clock::now();
            
            // 1. Check for pending requests - with proper timestamp formatting
            auto now = std::chrono::system_clock::now();
            auto now_time = std::chrono::system_clock::to_time_t(now);
            std::cout << "\n[" << std::put_time(std::localtime(&now_time), "%Y-%m-%d %H:%M:%S") 
                      << "] Checking requests..." << std::endl;
            
            json pendingRequests = HttpGetJson("/api/translate/pending");
            
            // 2. Process requests if available
            if (pendingRequests.is_array()) {
                if (!pendingRequests.empty()) {
                    std::cout << "Found " << pendingRequests.size() << " request(s)" << std::endl;
                    for (const auto& req : pendingRequests) {
                        try {
                            ProcessRequest(req);
                            consecutive_errors = 0; // Reset error counter on success
                        } catch (const std::exception& e) {
                            std::cerr << "Error processing request: " << e.what() << std::endl;
                            if (++consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
                                throw std::runtime_error("Too many consecutive errors");
                            }
                        }
                    }
                } else {
                    std::cout << "No pending requests" << std::endl;
                }
            } else {
                std::cerr << "Invalid response format from server" << std::endl;
                if (++consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
                    throw std::runtime_error("Too many consecutive errors");
                }
            }

            // 3. Maintain check interval
            auto cycle_time = std::chrono::steady_clock::now() - cycle_start;
            auto sleep_time = std::chrono::seconds(CHECK_INTERVAL) - cycle_time;
            
            if (sleep_time > std::chrono::seconds(0)) {
                std::cout << "Waiting " 
                          << std::chrono::duration_cast<std::chrono::milliseconds>(sleep_time).count() 
                          << "ms until next check" << std::endl;
                std::this_thread::sleep_for(sleep_time);
            }
            
        } catch (const std::exception& e) {
            std::cerr << "\n!!! MAIN LOOP ERROR: " << e.what() << std::endl;
            std::cerr << "Restarting after " << CHECK_INTERVAL << " seconds...\n" << std::endl;
            std::this_thread::sleep_for(std::chrono::seconds(CHECK_INTERVAL));
        }
    }

    return 0;
}