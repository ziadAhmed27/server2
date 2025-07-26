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

using json = nlohmann::json;

// Server configuration
const std::string SERVER_BASE_URL = "https://server2-production-3f9a.up.railway.app";
const std::string PENDING_ENDPOINT = "/api/recognize-place/pending";
const std::string RESULT_ENDPOINT = "/api/recognize-place/result";
const std::string DOWNLOADS_DIR = "place_downloads";
const std::string PYTHON_SCRIPT = "pyApp\\predict.py";
const int MAX_RETRIES = 3;

std::string getExecutablePath() {
    char path[MAX_PATH];
    GetModuleFileNameA(NULL, path, MAX_PATH);
    std::string::size_type pos = std::string(path).find_last_of("\\/");
    return std::string(path).substr(0, pos);
}

std::string exec(const char* cmd) {
    char buffer[128];
    std::string result = "";
    FILE* pipe = _popen(cmd, "r");
    if (!pipe) throw std::runtime_error("_popen() failed!");
    
    try {
        while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            // Convert to UTF-8 or clean invalid characters
            std::string temp(buffer);
            for (char& c : temp) {
                if (static_cast<unsigned char>(c) > 127) {
                    c = '?'; // Replace non-ASCII with '?'
                }
            }
            result += temp;
        }
    } catch (...) {
        _pclose(pipe);
        throw;
    }
    
    _pclose(pipe);
    return result;
}

bool download_file(httplib::Client& cli, const std::string& url, const std::string& path) {
    auto res = cli.Get(url.c_str());
    if (res && res->status == 200) {
        std::ofstream file(path, std::ios::binary);
        file.write(res->body.c_str(), res->body.size());
        return true;
    }
    return false;
}

int main() {
    try {
        std::string exePath = getExecutablePath();
        std::string pythonScriptPath = exePath + "\\" + PYTHON_SCRIPT;
        std::string downloadsPath = exePath + "\\" + DOWNLOADS_DIR;

        std::cout << "Place recognition worker started." << std::endl;
        std::cout << "Python script: " << pythonScriptPath << std::endl;
        std::cout << "Downloads dir: " << downloadsPath << std::endl;

        _mkdir(downloadsPath.c_str());

        httplib::Client cli(SERVER_BASE_URL);
        cli.set_connection_timeout(30);
        cli.set_read_timeout(60);
        cli.enable_server_certificate_verification(false); // For Railway's SSL

        while (true) {
            std::cout << "Checking for pending tasks..." << std::endl;
            auto res = cli.Get(PENDING_ENDPOINT.c_str());

            if (res && res->status == 200) {
                try {
                    json pending_tasks = json::parse(res->body);

                    if (pending_tasks.empty()) {
                        std::cout << "No pending tasks." << std::endl;
                    } else {
                        for (const auto& task : pending_tasks) {
                            std::string request_id = task["request_id"];
                            std::string image_url = task["image_url"];
                            std::string filename = image_url.substr(image_url.find_last_of("/") + 1);
                            std::string local_path = downloadsPath + "\\" + filename;

                            std::cout << "Processing task " << request_id << "..." << std::endl;

                            // Download with retries
                            bool downloaded = false;
                            for (int i = 0; i < MAX_RETRIES && !downloaded; i++) {
                                downloaded = download_file(cli, SERVER_BASE_URL + image_url, local_path);
                                if (!downloaded) {
                                    std::this_thread::sleep_for(std::chrono::seconds(1));
                                }
                            }

                            if (downloaded) {
                                std::string command = "py \"" + pythonScriptPath + "\" \"" + local_path + "\"";
                                std::cout << "Executing: " << command << std::endl;
                                std::string output = exec(command.c_str());
                                output.erase(output.find_last_not_of(" \n\r\t")+1);

                                // Clean up
                                std::remove(local_path.c_str());

                                if (!output.empty()) {
    try {
        // Parse the JSON output from Python
        json python_output = json::parse(output);
        
        // Debug print to verify we're getting the description
        std::cout << "Python output: " << python_output.dump() << std::endl;
        
        // Create result payload with separate keys
        json result_payload = {
            {"request_id", request_id},
            {"label", python_output["label"]},
            {"description", python_output["description"]},  // Make sure this line is present
            {"status", "done"},
            {"image_url", image_url}
        };
        
        // Debug print to verify the final payload
        std::cout << "Sending payload: " << result_payload.dump() << std::endl;
        
        auto post_res = cli.Post(RESULT_ENDPOINT.c_str(), 
                               result_payload.dump(), "application/json");
        
        if (post_res && post_res->status == 200) {
            std::cout << "Result sent successfully." << std::endl;
        } else {
            std::cerr << "Failed to send result." << std::endl;
            if (post_res) {
                std::cerr << "Server response: " << post_res->body << std::endl;
            }
        }
    } catch (const json::exception& e) {
        std::cerr << "JSON creation error: " << e.what() << std::endl;
        std::cerr << "Problematic output was: " << output << std::endl;
    }
}
                            } else {
                                std::cerr << "Failed to download image after " << MAX_RETRIES << " attempts." << std::endl;
                            }
                        }
                    }
                } catch (const json::parse_error& e) {
                    std::cerr << "JSON parse error: " << e.what() << std::endl;
                }
            } else if (res) {
                std::cerr << "Server error: " << res->status << std::endl;
                std::cerr << "Response: " << res->body << std::endl;
            } else {
                std::cerr << "Failed to connect to server." << std::endl;
            }

            std::this_thread::sleep_for(std::chrono::seconds(5));
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << std::endl;
        system("pause");
    }
    return 0;
}