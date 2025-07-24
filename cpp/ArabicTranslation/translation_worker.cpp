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
const std::string SERVER_HOST = "https://server2-production-3f9a.up.railway.app";
const int SERVER_PORT = 3000;
const std::string DOWNLOAD_DIR = "downloads";
const std::string PYTHON_APP = "pyApp\\translation.py";
const int CHECK_INTERVAL = 3; // seconds

// Download a file from URL
bool DownloadFile(const std::string& url, const std::string& outputPath) {
    // Parse URL to get host and path
    size_t scheme_end = url.find("://");
    if (scheme_end == std::string::npos) return false;
    
    size_t host_start = scheme_end + 3;
    size_t path_start = url.find('/', host_start);
    
    std::string host = path_start == std::string::npos 
        ? url.substr(host_start) 
        : url.substr(host_start, path_start - host_start);
    
    std::string path = path_start == std::string::npos 
        ? "/" 
        : url.substr(path_start);
    
    bool is_https = url.find("https://") == 0;
    
    // Create client
    httplib::Client cli(host.c_str(), is_https ? 443 : 80);
    if (is_https) {
        cli.enable_server_certificate_verification(false);
    }
    
    auto res = cli.Get(path, [&](const char* data, size_t data_length) {
        std::ofstream ofs(outputPath, std::ios::binary | std::ios::app);
        if (!ofs) return false;
        ofs.write(data, data_length);
        return true;
    });

    return res && res->status == 200;
}

// Make HTTP GET request with JSON response
json HttpGetJson(const std::string& path) {
    httplib::Client cli(SERVER_HOST, SERVER_PORT);
    auto res = cli.Get(path);
    if (res && res->status == 200) {
        try {
            return json::parse(res->body);
        } catch (...) {
            return nullptr;
        }
    }
    return nullptr;
}

// Make HTTP POST request with JSON
json HttpPostJson(const std::string& path, const json& data) {
    httplib::Client cli(SERVER_HOST, SERVER_PORT);
    auto res = cli.Post(path, data.dump(), "application/json");
    if (res && res->status == 200) {
        try {
            return json::parse(res->body);
        } catch (...) {
            return nullptr;
        }
    }
    return nullptr;
}

// Run Python script and get output
std::string RunPythonScript(const std::string& scriptPath, const std::string& inputFile) {
    std::string command = "py " + scriptPath + " \"" + inputFile + "\"";
    std::array<char, 128> buffer;
    std::string result;

    FILE* pipe = _popen(command.c_str(), "r");
    if (!pipe) throw std::runtime_error("_popen() failed!");

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
        
        // Create downloads directory if it doesn't exist
        if (!fs::exists(DOWNLOAD_DIR)) {
            fs::create_directory(DOWNLOAD_DIR);
        }

        std::string filePath;
        std::string arabicText;

        if (inputType == "raw_text") {
            // For raw text requests, just use the text directly
            arabicText = request["arabic_text"];
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

        // Prepare input for Python script
        if (inputType == "raw_text") {
            // Create a temporary JSON file for raw text
            filePath = DOWNLOAD_DIR + "/" + requestId + ".json";
            json tempJson = {{"arabic_text", arabicText}};
            std::ofstream(filePath) << tempJson.dump();
        }

        // Run Python translation
        std::string pythonOutput = RunPythonScript(PYTHON_APP, filePath);
        
        // Parse Python output
        json result;
        try {
            result = json::parse(pythonOutput);
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

        json completeResponse = HttpPostJson("/api/translate/complete", completeData);
        std::cout << "Completed request " << requestId << std::endl;

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

    while (true) {
        try {
            // Check for pending translation requests
            json pendingRequests = HttpGetJson("/api/translate/pending");
            
            if (pendingRequests.is_array() && !pendingRequests.empty()) {
                for (const auto& req : pendingRequests) {
                    std::cout << "Processing request: " << req["request_id"] << std::endl;
                    ProcessRequest(req);
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "Error in main loop: " << e.what() << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::seconds(CHECK_INTERVAL));
    }

    return 0;
}