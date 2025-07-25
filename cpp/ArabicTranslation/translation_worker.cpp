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

namespace fs = std::filesystem;
using json = nlohmann::json;

// Configuration
const std::string SERVER_HOST = "https://server2-production-3f9a.up.railway.app/"; // or your server address
const int SERVER_PORT = 3000;
const std::string DOWNLOAD_DIR = "downloads";
const std::string PYTHON_APP = "pyApp\\translation.py";
const int CHECK_INTERVAL = 3; // seconds

// Download a file from URL
bool DownloadFile(const std::string& url, const std::string& outputPath) {
    httplib::Client cli(SERVER_HOST, SERVER_PORT);
    auto res = cli.Get(url);
    
    if (res && res->status == 200) {
        std::ofstream ofs(outputPath, std::ios::binary);
        if (!ofs) {
            std::cerr << "Failed to create file: " << outputPath << std::endl;
            return false;
        }
        ofs << res->body;
        return true;
    }
    std::cerr << "Failed to download file. Status: " << (res ? res->status : 0) << std::endl;
    return false;
}

// Make HTTP GET request
json HttpGetJson(const std::string& path) {
    httplib::Client cli(SERVER_HOST, SERVER_PORT);
    auto res = cli.Get(path);
    
    if (res && res->status == 200) {
        try {
            return json::parse(res->body);
        } catch (const std::exception& e) {
            std::cerr << "JSON parse error: " << e.what() << std::endl;
        }
    } else {
        std::cerr << "HTTP GET failed. Status: " << (res ? res->status : 0) << std::endl;
    }
    return nullptr;
}

// Make HTTP POST request with JSON
bool HttpPostJson(const std::string& path, const json& data) {
    httplib::Client cli(SERVER_HOST, SERVER_PORT);
    auto res = cli.Post(path, data.dump(), "application/json");
    
    if (res && res->status == 200) {
        return true;
    }
    std::cerr << "HTTP POST failed. Status: " << (res ? res->status : 0) << std::endl;
    return false;
}

// Run Python script and get output
std::string RunPythonScript(const std::string& scriptPath, const std::string& inputFile) {
    std::string command = "python " + scriptPath + " \"" + inputFile + "\"";
    std::array<char, 128> buffer;
    std::string result;

    FILE* pipe = _popen(command.c_str(), "r");
    if (!pipe) {
        throw std::runtime_error("_popen() failed!");
    }

    while (fgets(buffer.data(), buffer.size(), pipe) != nullptr) {
        result += buffer.data();
    }

    _pclose(pipe);
    return result;
}

// Process a translation request
void ProcessRequest(const json& request) {
    try {
        std::string requestId = request["request_id"];
        std::string inputType = request["input_type"];
        
        std::cout << "Processing request: " << requestId << std::endl;

        // Create downloads directory if it doesn't exist
        if (!fs::exists(DOWNLOAD_DIR)) {
            fs::create_directory(DOWNLOAD_DIR);
        }

        std::string filePath;
        std::string arabicText;

        if (inputType == "raw_text") {
            // For raw text requests, just use the text directly
            arabicText = request["arabic_text"];
            // Create a temporary JSON file
            filePath = DOWNLOAD_DIR + "/" + requestId + ".json";
            json tempJson = {{"arabic_text", arabicText}};
            std::ofstream(filePath) << tempJson.dump();
        } else {
            // For file requests, download the file
            std::string fileUrl = request["file_url"];
            std::string ext = (inputType == "json_file") ? ".json" : ".jpg";
            filePath = DOWNLOAD_DIR + "/" + requestId + ext;
            
            if (!DownloadFile(fileUrl, filePath)) {
                std::cerr << "Failed to download file: " << fileUrl << std::endl;
                return;
            }
        }

        // Run Python translation
        std::string pythonOutput = RunPythonScript(PYTHON_APP, filePath);
        
        // Parse Python output
        json result;
        try {
            result = json::parse(pythonOutput);
            if (result.contains("error") && !result["error"].empty()) {
                std::cerr << "Python error: " << result["error"] << std::endl;
                return;
            }
        } catch (const std::exception& e) {
            std::cerr << "Error parsing Python output: " << e.what() << std::endl;
            return;
        }

        // Send result back to server
        json completeData = {
            {"request_id", requestId},
            {"arabic_text", result.value("arabic_text", "")},
            {"english_translation", result.value("english_translation", "")}
        };

        if (!HttpPostJson("/api/translate/complete", completeData)) {
            std::cerr << "Failed to post completion for request: " << requestId << std::endl;
        } else {
            std::cout << "Successfully completed request: " << requestId << std::endl;
        }

        // Clean up downloaded file
        if (fs::exists(filePath)) {
            fs::remove(filePath);
        }
    } catch (const std::exception& e) {
        std::cerr << "Error processing request: " << e.what() << std::endl;
    }
}

int main() {
    std::cout << "Translation Processor started. Checking for new requests every " 
              << CHECK_INTERVAL << " seconds." << std::endl;

    // Create downloads directory if it doesn't exist
    if (!fs::exists(DOWNLOAD_DIR)) {
        fs::create_directory(DOWNLOAD_DIR);
    }

    while (true) {
        try {
            // Check for pending translation requests
            std::cout << "Checking for pending requests..." << std::endl;
            json pendingRequests = HttpGetJson("/api/translate/pending");
            
            if (pendingRequests.is_array() && !pendingRequests.empty()) {
                for (const auto& req : pendingRequests) {
                    ProcessRequest(req);
                }
            } else if (!pendingRequests.is_null()) {
                std::cout << "No pending requests found." << std::endl;
            }
        } catch (const std::exception& e) {
            std::cerr << "Error in main loop: " << e.what() << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::seconds(CHECK_INTERVAL));
    }

    return 0;
}