#include <iostream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include <curl/curl.h>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json = nlohmann::json;

// Configuration
const std::string SERVER_URL = "https://server2-production-3f9a.up.railway.app/";
const std::string DOWNLOAD_DIR = "downloads";
const std::string PYTHON_APP = "pyApp/translation.py";
const int CHECK_INTERVAL = 3; // seconds

// Callback function for writing downloaded data
static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    ((std::string*)userp)->append((char*)contents, size * nmemb);
    return size * nmemb;
}

// Download a file from URL
bool DownloadFile(const std::string& url, const std::string& outputPath) {
    CURL* curl = curl_easy_init();
    if (!curl) return false;

    FILE* fp = fopen(outputPath.c_str(), "wb");
    if (!fp) {
        curl_easy_cleanup(curl);
        return false;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, NULL);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, fp);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

    CURLcode res = curl_easy_perform(curl);
    fclose(fp);
    curl_easy_cleanup(curl);

    return res == CURLE_OK;
}

// Make HTTP GET request
std::string HttpGet(const std::string& url) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (curl) {
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_perform(curl);
        curl_easy_cleanup(curl);
    }

    return response;
}

// Make HTTP POST request with JSON
std::string HttpPostJson(const std::string& url, const json& data) {
    CURL* curl = curl_easy_init();
    std::string response;
    std::string jsonStr = data.dump();

    if (curl) {
        struct curl_slist* headers = NULL;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonStr.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, jsonStr.length());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

        curl_easy_perform(curl);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
    }

    return response;
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
void ProcessRequest(const std::string& requestId, const std::string& fileUrl, const std::string& processingPath) {
    try {
        // Create downloads directory if it doesn't exist
        if (!fs::exists(DOWNLOAD_DIR)) {
            fs::create_directory(DOWNLOAD_DIR);
        }

        // Download the file
        std::string filePath = DOWNLOAD_DIR + "/" + requestId + (processingPath.find(".json") != std::string::npos ? ".json" : ".jpg");
        if (!DownloadFile(SERVER_URL + fileUrl, filePath)) {
            std::cerr << "Failed to download file: " << fileUrl << std::endl;
            return;
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

        std::string completeResponse = HttpPostJson(SERVER_URL + "/api/translate/complete", completeData);
        std::cout << "Completed request " << requestId << " with response: " << completeResponse << std::endl;

        // Clean up downloaded file
        fs::remove(filePath);
    } catch (const std::exception& e) {
        std::cerr << "Error processing request " << requestId << ": " << e.what() << std::endl;
    }
}

int main() {
    // Initialize libcurl
    curl_global_init(CURL_GLOBAL_DEFAULT);

    std::cout << "Translation Processor started. Checking for new requests every " << CHECK_INTERVAL << " seconds." << std::endl;

    while (true) {
        try {
            // Check for pending translation requests
            std::string pendingResponse = HttpGet(SERVER_URL + "/api/translate/pending");
            
            try {
                json pendingRequests = json::parse(pendingResponse);
                
                if (pendingRequests.is_array() && !pendingRequests.empty()) {
                    for (const auto& req : pendingRequests) {
                        std::string requestId = req["request_id"];
                        std::string fileUrl = req["file_url"];
                        std::string processingPath = req["processing_path"];
                        
                        std::cout << "Processing request: " << requestId << std::endl;
                        ProcessRequest(requestId, fileUrl, processingPath);
                    }
                }
            } catch (const std::exception& e) {
                std::cerr << "Error parsing pending requests: " << e.what() << std::endl;
            }
        } catch (const std::exception& e) {
            std::cerr << "Error in main loop: " << e.what() << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::seconds(CHECK_INTERVAL));
    }

    // Cleanup libcurl
    curl_global_cleanup();
    return 0;
}