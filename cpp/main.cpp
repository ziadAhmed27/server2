#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h"
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include "nlohmann/json.hpp"
#include <direct.h> // For _mkdir

using json = nlohmann::json;

// Server configuration
const std::string SERVER_DOMAIN = "server2-production-3f9a.up.railway.app";
const std::string SERVER_BASE_URL = "https://server2-production-3f9a.up.railway.app";
const std::string PENDING_ENDPOINT = "/api/recognize-place/pending";
const std::string RESULT_ENDPOINT = "/api/recognize-place/result";
const std::string DOWNLOADS_DIR = "downloads";

// Function to execute a command and capture its output
std::string exec(const char* cmd) {
    char buffer[128];
    std::string result;
    FILE* pipe = _popen(cmd, "r");
    if (!pipe) throw std::runtime_error("_popen() failed!");
    try {
        while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            result += buffer;
        }
    }
    catch (...) {
        _pclose(pipe);
        throw;
    }
    _pclose(pipe);
    return result;
}

// Function to download a file
bool download_file(httplib::SSLClient& cli, const std::string& url, const std::string& path) {
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
        std::cout << "Program started." << std::endl;

        // Ensure downloads directory exists
        _mkdir(DOWNLOADS_DIR.c_str());

        httplib::SSLClient cli(SERVER_DOMAIN.c_str());
        cli.set_connection_timeout(10); // 10 seconds
        cli.enable_server_certificate_verification(false); // Optional: disable cert check for dev

        while (true) {
            std::cout << "Checking for pending tasks..." << std::endl;

            auto res = cli.Get(PENDING_ENDPOINT.c_str());

            if (res && res->status == 200) {
                try {
                    json pending_tasks = json::parse(res->body);

                    if (pending_tasks.empty()) {
                        std::cout << "No pending tasks." << std::endl;
                    }
                    else {
                        for (const auto& task : pending_tasks) {
                            std::string request_id = task["request_id"];
                            std::string image_url = task["image_url"];
                            std::string filename = image_url.substr(image_url.find_last_of("/") + 1);
                            std::string local_path = DOWNLOADS_DIR + "/" + filename;

                            std::cout << "Processing task " << request_id << "..." << std::endl;

                            std::string full_image_url = SERVER_BASE_URL + image_url;
                            if (download_file(cli, full_image_url, local_path)) {
                                std::cout << "Downloaded " << filename << std::endl;

                                // Run Python prediction script
                                std::string command = "python ../IOT_py/placerec/predict.py \"" + local_path + "\"";
                                std::string label = exec(command.c_str());
                                label.erase(label.find_last_not_of(" \n\r\t") + 1);

                                std::cout << "Recognition result: " << label << std::endl;

                                // Post result to server
                                json result_payload = {
                                    {"request_id", request_id},
                                    {"label", label}
                                };

                                auto post_res = cli.Post(RESULT_ENDPOINT.c_str(), result_payload.dump(), "application/json");
                                if (post_res && post_res->status == 200) {
                                    std::cout << "Result sent for " << request_id << std::endl;
                                }
                                else {
                                    std::cerr << "Failed to post result for " << request_id << std::endl;
                                }

                            }
                            else {
                                std::cerr << "Failed to download " << image_url << std::endl;
                            }
                        }
                    }
                }
                catch (const json::parse_error& e) {
                    std::cerr << "JSON parse error: " << e.what() << std::endl;
                }
            }
            else {
                std::cerr << "Failed to connect to server or bad response." << std::endl;
                if (res) {
                    std::cerr << "HTTP status: " << res->status << std::endl;
                    std::cerr << "Response body: " << res->body << std::endl;
                }
                else {
                    std::cerr << "Connection failed. No response received." << std::endl;
                }
            }

            std::this_thread::sleep_for(std::chrono::seconds(5));
        }
    }
    catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << std::endl;
        system("pause");
    }

    return 0;
}
