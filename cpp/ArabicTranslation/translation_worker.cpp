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
#include <locale>
#include <codecvt>

using json = nlohmann::json;

// Server configuration
const std::string SERVER_BASE_URL = "https://server2-production-3f9a.up.railway.app";
const std::string PENDING_ENDPOINT = "/api/translate/pending";
const std::string RESULT_ENDPOINT = "/api/translate/result";
const std::string DOWNLOADS_DIR = "translation_downloads";
const std::string PYTHON_SCRIPT = "pyApp\\translation.py";
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
            result += buffer;
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

void process_translation_task(httplib::Client& cli, const json& task, 
                            const std::string& pythonScriptPath,
                            const std::string& downloadsPath) {
    std::string request_id;
    try {
        request_id = task["request_id"].get<std::string>();
    } catch (...) {
        std::cerr << "Invalid task format - missing request_id" << std::endl;
        return;
    }

    std::cout << "Processing translation task " << request_id << "..." << std::endl;

    for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            if (!task.contains("text_input") || task["text_input"].is_null()) {
                std::cerr << "No text input provided" << std::endl;
                return;
            }

            std::string text_input = task["text_input"].get<std::string>();
            if (text_input.empty()) {
                std::cerr << "Empty text input" << std::endl;
                return;
            }

            // Create a temporary file for the text with UTF-8 encoding
            std::string temp_file_path = downloadsPath + "\\text_" + request_id + ".txt";
            std::ofstream temp_file(temp_file_path, std::ios::binary);
            temp_file << "\xEF\xBB\xBF"; // UTF-8 BOM
            temp_file << text_input;
            temp_file.close();
            
            // Modified command to pass text directly if it's short enough
            std::string command;
            if (text_input.length() < 8000) { // Command line length limit
                // Escape quotes for command line
                std::string escaped_text;
                for (char c : text_input) {
                    if (c == '"') escaped_text += "\\\"";
                    else escaped_text += c;
                }
                command = "py \"" + pythonScriptPath + "\" \"" + escaped_text + "\"";
            } else {
                command = "py \"" + pythonScriptPath + "\" \"" + temp_file_path + "\"";
            }

            std::cout << "Executing: " << command << std::endl;
            std::string output = exec(command.c_str());

            // Clean up temporary file
            std::remove(temp_file_path.c_str());

            if (output.empty()) {
                std::cerr << "Empty output from translation script (attempt " << (attempt+1) << ")" << std::endl;
                if (attempt < MAX_RETRIES - 1) {
                    std::this_thread::sleep_for(std::chrono::seconds(1));
                    continue;
                }
                return;
            }

            try {
                auto result = json::parse(output);
                
                if (result.contains("error")) {
                    std::cerr << "Translation error: " << result["error"].get<std::string>() << std::endl;
                    if (attempt < MAX_RETRIES - 1) {
                        std::this_thread::sleep_for(std::chrono::seconds(1));
                        continue;
                    }
                    return;
                }

                if (!result.contains("arabic_text") || !result.contains("english_translation")) {
                    std::cerr << "Invalid response format from translation script" << std::endl;
                    if (attempt < MAX_RETRIES - 1) {
                        std::this_thread::sleep_for(std::chrono::seconds(1));
                        continue;
                    }
                    return;
                }

                json result_payload = {
                    {"request_id", request_id},
                    {"arabic_text", result["arabic_text"].get<std::string>()},
                    {"english_translation", result["english_translation"].get<std::string>()}
                };
                
                auto post_res = cli.Post(RESULT_ENDPOINT.c_str(), 
                    result_payload.dump(), "application/json");
                
                if (post_res && post_res->status == 200) {
                    std::cout << "Translation result sent successfully." << std::endl;
                    return; // Success - exit retry loop
                } else {
                    std::cerr << "Failed to send translation result." << std::endl;
                    if (post_res) {
                        std::cerr << "HTTP status: " << post_res->status << std::endl;
                    }
                    if (attempt < MAX_RETRIES - 1) {
                        std::this_thread::sleep_for(std::chrono::seconds(1));
                        continue;
                    }
                }
            } catch (const std::exception& e) {
                std::cerr << "Error parsing translation output: " << e.what() << std::endl;
                std::cerr << "Raw output: " << output << std::endl;
                if (attempt < MAX_RETRIES - 1) {
                    std::this_thread::sleep_for(std::chrono::seconds(1));
                    continue;
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "Error processing task " << request_id << " (attempt " << (attempt+1) << "): " << e.what() << std::endl;
            if (attempt < MAX_RETRIES - 1) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
                continue;
            }
        }
    }
}

int main() {
    try {
        std::string exePath = getExecutablePath();
        std::string pythonScriptPath = exePath + "\\" + PYTHON_SCRIPT;
        std::string downloadsPath = exePath + "\\" + DOWNLOADS_DIR;

        std::cout << "Translation worker started." << std::endl;
        std::cout << "Python script: " << pythonScriptPath << std::endl;
        std::cout << "Downloads dir: " << downloadsPath << std::endl;

        _mkdir(downloadsPath.c_str());

        httplib::Client cli(SERVER_BASE_URL);
        cli.set_connection_timeout(30);
        cli.set_read_timeout(60);
        cli.enable_server_certificate_verification(false);

        while (true) {
            std::cout << "Checking for pending translation tasks..." << std::endl;
            auto res = cli.Get(PENDING_ENDPOINT.c_str());

            if (res) {
                if (res->status == 200) {
                    try {
                        json pending_tasks = json::parse(res->body);

                        if (pending_tasks.empty()) {
                            std::cout << "No pending translation tasks." << std::endl;
                        } else {
                            for (const auto& task : pending_tasks) {
                                process_translation_task(cli, task, pythonScriptPath, downloadsPath);
                            }
                        }
                    } catch (const json::parse_error& e) {
                        std::cerr << "JSON parse error: " << e.what() << std::endl;
                        std::cerr << "Response body: " << res->body << std::endl;
                    }
                } else {
                    std::cerr << "Server error: " << res->status << std::endl;
                    std::cerr << "Response: " << res->body << std::endl;
                }
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