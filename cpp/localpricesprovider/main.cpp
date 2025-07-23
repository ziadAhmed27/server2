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

using json = nlohmann::json;

// Server configuration
const std::string SERVER_BASE_URL = "http://server2-production-3f9a.up.railway.app";
const std::string PENDING_ENDPOINT = "/api/check-price/pending";
const std::string RESULT_ENDPOINT = "/api/check-price/result";
const std::string DOWNLOADS_DIR = "price_downloads";

// Function to execute a command and capture its output
std::string exec(const char* cmd) {
    char buffer[128];
    std::string result = "";
    FILE* pipe = _popen(cmd, "r");
    if (!pipe) throw std::runtime_error("_popen() failed!");
    try {
        while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            result += buffer;
        }
    } catch (...) {
        _pclose(pipe);
        throw;
    }
    _pclose(pipe);
    return result;
}

// Function to download a file
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
        std::cout << "Price check worker started." << std::endl;
        // Ensure downloads directory exists
        _mkdir(DOWNLOADS_DIR.c_str());

        httplib::Client cli(SERVER_BASE_URL);
        cli.set_connection_timeout(10);

        while (true) {
            std::cout << "Checking for pending price check tasks..." << std::endl;
            auto res = cli.Get(PENDING_ENDPOINT.c_str());

            if (res && res->status == 200) {
                try {
                    json pending_tasks = json::parse(res->body);

                    if (pending_tasks.empty()) {
                        std::cout << "No pending price check tasks." << std::endl;
                    } else {
                        for (const auto& task : pending_tasks) {
                            std::string request_id = task["request_id"];
                            std::string image_url = task["image_url"];
                            std::string filename = image_url.substr(image_url.find_last_of("/") + 1);
                            std::string local_path = DOWNLOADS_DIR + "/" + filename;

                            std::cout << "Processing price check task " << request_id << "..." << std::endl;

                            // Download from full URL
                            std::string full_image_url = SERVER_BASE_URL + image_url;
                            if (download_file(cli, full_image_url, local_path)) {
                                std::cout << "Downloaded " << filename << std::endl;

                                // Run Python script
                                std::string command = "python priceAssistant.py \"" + local_path + "\"";
                                std::string output = exec(command.c_str());
                                
                                try {
                                    json result = json::parse(output);
                                    
                                    // Post result
                                    json result_payload = {
                                        {"request_id", request_id},
                                        {"result", result}
                                    };
                                    auto post_res = cli.Post(RESULT_ENDPOINT.c_str(), result_payload.dump(), "application/json");
                                    
                                    if (post_res && post_res->status == 200) {
                                        std::cout << "Price result sent for " << request_id << std::endl;
                                        // Clean up downloaded file
                                        std::remove(local_path.c_str());
                                    } else {
                                        std::cerr << "Failed to send result for " << request_id << std::endl;
                                    }
                                } catch (const json::parse_error& e) {
                                    std::cerr << "Failed to parse Python script output: " << e.what() << std::endl;
                                    std::cerr << "Raw output: " << output << std::endl;
                                }

                            } else {
                                std::cerr << "Failed to download " << image_url << std::endl;
                            }
                        }
                    }
                } catch (const json::parse_error& e) {
                    std::cerr << "JSON parse error: " << e.what() << std::endl;
                }
            } else {
                std::cerr << "Failed to connect to server or bad response." << std::endl;
            }

            std::this_thread::sleep_for(std::chrono::seconds(5));
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << std::endl;
        system("pause");
    }
    return 0;
}