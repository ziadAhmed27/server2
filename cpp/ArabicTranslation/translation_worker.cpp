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

std::string escape_json(const std::string &s) {
    std::ostringstream o;
    for (auto c = s.cbegin(); c != s.cend(); c++) {
        if (*c == '"' || *c == '\\' || ('\x00' <= *c && *c <= '\x1f')) {
            o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << (int)*c;
        } else {
            o << *c;
        }
    }
    return o.str();
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

            if (res && res->status == 200) {
                try {
                    json pending_tasks = json::parse(res->body);

                    if (pending_tasks.empty()) {
                        std::cout << "No pending translation tasks." << std::endl;
                    } else {
                        for (const auto& task : pending_tasks) {
                            std::string request_id = task["request_id"];
                            std::string image_url = task.value("image_url", "");
                            std::string text_input = task.value("text_input", "");

                            std::cout << "Processing translation task " << request_id << "..." << std::endl;

                            std::string command;
                            if (!image_url.empty()) {
                                std::string filename = image_url.substr(image_url.find_last_of("/") + 1);
                                std::string local_path = downloadsPath + "\\" + filename;

                                // Download with retries
                                bool downloaded = false;
                                for (int i = 0; i < MAX_RETRIES && !downloaded; i++) {
                                    downloaded = download_file(cli, SERVER_BASE_URL + image_url, local_path);
                                    if (!downloaded) {
                                        std::this_thread::sleep_for(std::chrono::seconds(1));
                                    }
                                }

                                if (downloaded) {
                                    command = "python \"" + pythonScriptPath + "\" \"" + local_path + "\"";
                                    std::remove(local_path.c_str());
                                } else {
                                    continue;
                                }
                            } else if (!text_input.empty()) {
                                // Escape text for command line
                                std::string escaped_text = "\"" + text_input + "\"";
                                command = "python \"" + pythonScriptPath + "\" " + escaped_text;
                            } else {
                                continue;
                            }

                            std::cout << "Executing: " << command << std::endl;
                            std::string output = exec(command.c_str());

                            if (!output.empty()) {
                                try {
                                    // Parse the output (assuming format: "Arabic Text:\n...\n\nEnglish Translation:\n...")
                                    size_t arabic_start = output.find("Arabic Text:\n") + 13;
                                    size_t arabic_end = output.find("\n\nEnglish Translation:");
                                    size_t english_start = output.find("\n\nEnglish Translation:\n") + 23;
                                    
                                    std::string arabic_text = output.substr(arabic_start, arabic_end - arabic_start);
                                    std::string english_translation = output.substr(english_start);
                                    
                                    // Clean up newlines
                                    arabic_text.erase(std::remove(arabic_text.begin(), arabic_text.end(), '\n'), arabic_text.end());
                                    english_translation.erase(std::remove(english_translation.begin(), english_translation.end(), '\n'), english_translation.end());

                                    json result_payload = {
                                        {"request_id", request_id},
                                        {"arabic_text", arabic_text},
                                        {"english_translation", english_translation}
                                    };
                                    
                                    auto post_res = cli.Post(RESULT_ENDPOINT.c_str(), 
                                        result_payload.dump(), "application/json");
                                    
                                    if (post_res && post_res->status == 200) {
                                        std::cout << "Translation result sent successfully." << std::endl;
                                    } else {
                                        std::cerr << "Failed to send translation result." << std::endl;
                                    }
                                } catch (const std::exception& e) {
                                    std::cerr << "Error parsing translation output: " << e.what() << std::endl;
                                }
                            }
                        }
                    }
                } catch (const json::parse_error& e) {
                    std::cerr << "JSON parse error: " << e.what() << std::endl;
                }
            } else if (res) {
                std::cerr << "Server error: " << res->status << std::endl;
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