use regex::Regex;
use reqwest::blocking::Client;
use scraper::{Html, Selector};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::time::Duration;

const FIRST_CHAPTER_COUNT: usize = 10;

fn decrypt_text(text: &str) -> String {
    // Decryption configuration from the original project
    let code: [[u32; 2]; 2] = [[58344, 58715], [58345, 58716]];
    let charset: [Vec<char>; 2] = [
        vec![
            'D', '在', '主', '特', '家', '军', '然', '表', '场', '4', '要', '只', 'v', '和', '?',
            '6', '别', '还', 'g', '现', '儿', '岁', '?', '?', '此', '象', '月', '3', '出', '战',
            '工', '相', 'o', '男', '直', '失', '世', 'F', '都', '平', '文', '什', 'V', 'O', '将',
            '真', 'T', '那', '当', '?', '会', '立', '些', 'u', '是', '十', '张', '学', '气', '大',
            '爱', '两', '命', '全', '后', '东', '性', '通', '被', '1', '它', '乐', '接', '而',
            '感', '车', '山', '公', '了', '常', '以', '何', '可', '话', '先', 'p', 'i', '叫', '轻',
            'M', '士', 'w', '着', '变', '尔', '快', 'l', '个', '说', '少', '色', '里', '安', '花',
            '远', '7', '难', '师', '放', 't', '报', '认', '面', '道', 'S', '?', '克', '地', '度',
            'I', '好', '机', 'U', '民', '写', '把', '万', '同', '水', '新', '没', '书', '电', '吃',
            '像', '斯', '5', '为', 'y', '白', '几', '日', '教', '看', '但', '第', '加', '候', '作',
            '上', '拉', '住', '有', '法', 'r', '事', '应', '位', '利', '你', '声', '身', '国',
            '问', '马', '女', '他', 'Y', '比', '父', 'x', 'A', 'H', 'N', 's', 'X', '边', '美',
            '对', '所', '金', '活', '回', '意', '到', 'z', '从', 'j', '知', '又', '内', '因', '点',
            'Q', '三', '定', '8', 'R', 'b', '正', '或', '夫', '向', '德', '听', '更', '?', '得',
            '告', '并', '本', 'q', '过', '记', 'L', '让', '打', 'f', '人', '就', '者', '去', '原',
            '满', '体', '做', '经', 'K', '走', '如', '孩', 'c', 'G', '给', '使', '物', '?', '最',
            '笑', '部', '?', '员', '等', '受', 'k', '行', '一', '条', '果', '动', '光', '门', '头',
            '见', '往', '自', '解', '成', '处', '天', '能', '于', '名', '其', '发', '总', '母',
            '的', '死', '手', '入', '路', '进', '心', '来', 'h', '时', '力', '多', '开', '已',
            '许', 'd', '至', '由', '很', '界', 'n', '小', '与', 'Z', '想', '代', '么', '分', '生',
            '口', '再', '妈', '望', '次', '西', '风', '種', '带', 'J', '?', '实', '情', '才', '这',
            '?', 'E', '我', '神', '格', '长', '觉', '间', '年', '眼', '无', '不', '亲', '关', '结',
            '0', '友', '信', '下', '却', '重', '己', '老', '2', '音', '字', 'm', '呢', '明', '之',
            '前', '高', 'P', 'B', '目', '太', 'e', '9', '起', '稜', '她', '也', 'W', '用', '方',
            '子', '英', '每', '理', '便', '四', '数', '期', '中', 'C', '外', '样', 'a', '海', '们',
            '任',
        ],
        vec![
            's', '?', '作', '口', '在', '他', '能', '并', 'B', '士', '4', 'U', '克', '才', '正',
            '们', '字', '声', '高', '全', '尔', '活', '者', '动', '其', '主', '报', '多', '望',
            '放', 'h', 'w', '次', '年', '?', '中', '3', '特', '于', '十', '入', '要', '男', '同',
            'G', '面', '分', '方', 'K', '什', '再', '教', '本', '己', '结', '1', '等', '世', 'N',
            '?', '说', 'g', 'u', '期', 'Z', '外', '美', 'M', '行', '给', '9', '文', '将', '两',
            '许', '张', '友', '0', '英', '应', '向', '像', '此', '白', '安', '少', '何', '打',
            '气', '常', '定', '间', '花', '见', '孩', '它', '直', '风', '数', '使', '道', '第',
            '水', '已', '女', '山', '解', 'd', 'P', '的', '通', '关', '性', '叫', '儿', 'L', '妈',
            '问', '回', '神', '来', 'S', ' ', '四', '望', '前', '国', '些', 'O', 'v', 'l', 'A',
            '心', '平', '自', '无', '军', '光', '代', '是', '好', '却', 'c', '得', '种', '就',
            '意', '先', '立', 'z', '子', '过', 'Y', 'j', '表', ' ', '么', '所', '接', '了', '名',
            '金', '受', 'J', '满', '眼', '没', '部', '那', 'm', '每', '车', '度', '可', 'R', '斯',
            '经', '现', '门', '明', 'V', '如', '走', '命', 'y', '6', 'E', '战', '很', '上', 'f',
            '月', '西', '7', '长', '夫', '想', '话', '变', '海', '机', 'x', '到', 'W', '一', '成',
            '生', '信', '笑', 'b', '父', '开', '内', '东', '马', '日', '小', '而', '后', '带',
            '以', '三', '几', '为', '认', 'X', '死', '员', '目', '位', '之', '学', '远', '人',
            '音', '呢', '我', 'q', '乐', '象', '重', '对', '个', '被', '别', 'F', '也', '书', '稜',
            'D', '写', '还', '因', '家', '发', '时', 'i', '或', '住', '德', '当', 'o', 'l', '比',
            '觉', '然', '吃', '去', '公', 'a', '老', '亲', '情', '体', '太', 'b', '万', 'C', '电',
            '理', '?', '失', '力', '更', '拉', '物', '着', '原', 's', '工', '实', '色', '感', '记',
            '看', '出', '相', '路', '大', '你', '候', '2', '和', '?', '与', 'p', '样', '新', '只',
            '便', '最', '不', '进', 'T', 'r', '做', '格', '母', '总', '爱', '身', '师', '轻', '知',
            '往', '加', '从', '?', '天', 'e', 'H', '?', '听', '场', '由', '快', '边', '让', '把',
            '任', '8', '条', '头', '事', '至', '起', '点', '真', '手', '这', '难', '都', '界',
            '用', '法', 'n', '处', '下', '又', 'Q', '告', '地', '5', 'k', 't', '岁', '有', '会',
            '果', '利', '民',
        ],
    ];

    let has_pua = text.chars().any(|c| {
        let u = c as u32;
        (58344..=58716).contains(&u)
    });

    if !has_pua {
        return text.to_string();
    }

    let mut mode_results = Vec::new();
    for mode in 0..2 {
        let mut q_count = 0;
        let mut decoded_chars = String::new();
        for char in text.chars() {
            let uni = char as u32;
            if uni >= code[mode][0] && uni <= code[mode][1] {
                let bias = (uni - code[mode][0]) as usize;
                if bias < charset[mode].len() {
                    let mapped_char = charset[mode][bias];
                    if mapped_char == '?' {
                        q_count += 1;
                        decoded_chars.push(char);
                    } else {
                        decoded_chars.push(mapped_char);
                    }
                } else {
                    q_count += 1;
                    decoded_chars.push(char);
                }
            } else {
                decoded_chars.push(char);
            }
        }
        mode_results.push((q_count, decoded_chars));
    }

    let best_mode = if mode_results[0].0 <= mode_results[1].0 {
        0
    } else {
        1
    };
    mode_results[best_mode].1.clone()
}

fn clean_html_content(content: &str) -> String {
    if content.is_empty() {
        return String::new();
    }
    let fragment = Html::parse_fragment(content);
    let mut paragraphs = Vec::new();

    // Find p and div tags
    let selector = Selector::parse("p, div").unwrap();
    for element in fragment.select(&selector) {
        let text = element.text().collect::<Vec<_>>().join("");
        let txt = text.trim();
        if !txt.is_empty() {
            paragraphs.push(txt.to_string());
        }
    }

    if paragraphs.is_empty() {
        let re = Regex::new(r"<[^>]+>").unwrap();
        let txt = re.replace_all(content, "\n");
        for line in txt.split('\n') {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                paragraphs.push(trimmed.to_string());
            }
        }
    }

    paragraphs.join("\n\n")
}

fn sanitize_filename(filename: &str) -> String {
    let mut safe = filename.to_string();
    let illegal_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let illegal_chars_rep = [
        "环境_＜",
        "环境_＞",
        "：",
        "＂",
        "／",
        "＼",
        "｜",
        "？",
        "＊",
    ];

    for (i, c) in illegal_chars.iter().enumerate() {
        safe = safe.replace(*c, illegal_chars_rep[i]);
    }
    safe.trim().to_string()
}

pub fn crawl_fanqie_article(
    url: &str,
    novel_type: &str,
    target_dir: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Check if it's a reader URL first
    let reader_match = Regex::new(r"/reader/(\d+)").unwrap().captures(url);
    if let Some(cap) = reader_match {
        let chapter_id = cap[1].to_string();

        let (title, content) = fetch_chapter_content(&client, &chapter_id)?;
        let decrypted = decrypt_text(&content);
        let cleaned = clean_html_content(&decrypted);

        let novel_name = if title.is_empty() {
            format!("短篇小说_{}", chapter_id)
        } else {
            title.clone()
        };

        let target_path = Path::new(target_dir);
        let md_content = format!(
            "# {}\n\n**原文链接**: {}\n\n---\n\n{}",
            novel_name, url, cleaned
        );

        let file_name = format!("{}.md", sanitize_filename(&novel_name));
        let file_path = target_path.join(&file_name);

        fs::write(&file_path, md_content).map_err(|e| format!("保存文件失败: {}", e))?;

        return Ok(format!(
            "成功爬取单章/短篇小说并保存至: {}",
            file_path.display()
        ));
    }

    let book_id_match = Regex::new(r"/page/(\d+)").unwrap().captures(url);
    let book_id = match book_id_match {
        Some(cap) => cap[1].to_string(),
        None => return Err("URL格式不正确，无法提取小说ID或章节ID".to_string()),
    };

    // Fetch the main page
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("请求失败，状态码: {}", response.status()));
    }
    let html = response
        .text()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if html.len() < 5000 || !html.contains("window.__INITIAL_STATE__") {
        return Err("触发番茄小说反爬验证拦截，页面内容异常。".to_string());
    }

    if let Some(title_start) = html.find("<title>") {
        if let Some(title_end) = html[title_start..].find("</title>") {
            let title = &html[title_start..title_start + title_end];
            let title_lower = title.to_lowercase();
            if title_lower.contains("验证")
                || title_lower.contains("captcha")
                || title_lower.contains("安全")
            {
                return Err(
                    "触发番茄小说反爬验证拦截，请在浏览器中访问该链接进行验证后重试。".to_string(),
                );
            }
        }
    }

    let document = Html::parse_document(&html);

    // Extract novel name
    let mut novel_name = String::new();
    let info_name_sel = Selector::parse("div.info-name h1").unwrap();
    if let Some(h1) = document.select(&info_name_sel).next() {
        novel_name = h1.text().collect::<String>().trim().to_string();
    } else {
        let h1_sel = Selector::parse("h1").unwrap();
        if let Some(h1) = document.select(&h1_sel).next() {
            novel_name = h1.text().collect::<String>().trim().to_string();
        }
    }

    if novel_name.is_empty() {
        novel_name = format!("未命名小说_{}", book_id);
    }

    let target_path = Path::new(target_dir);

    if novel_type == "番茄小说-短篇" {
        // Fetch full text directly or the single chapter.
        // Wait, short novel usually has a few chapters or just one page.
        // We'll extract chapter links, if there's only one, fetch it.
        // Or if the content is in the page, but Fanqie uses JS state.
        // Actually, short stories are just regular novels with 1 or a few chapters.
        let mut chapter_id = String::new();
        let a_sel = Selector::parse("a").unwrap();
        for a in document.select(&a_sel) {
            let href = a.value().attr("href").unwrap_or("");
            if href.contains("/reader/") {
                chapter_id = href.split('/').next_back().unwrap_or("").to_string();
                break;
            }
        }

        if chapter_id.is_empty() {
            return Err("未找到短篇小说阅读链接。".to_string());
        }

        let (_title, content) = fetch_chapter_content(&client, &chapter_id)?;
        let decrypted = decrypt_text(&content);
        let cleaned = clean_html_content(&decrypted);

        let md_content = format!(
            "# {}\n\n**原文链接**: {}\n\n---\n\n{}",
            novel_name, url, cleaned
        );

        let file_name = format!("{}.md", sanitize_filename(&novel_name));
        let file_path = target_path.join(&file_name);

        fs::write(&file_path, md_content).map_err(|e| format!("保存文件失败: {}", e))?;

        Ok(format!("成功爬取短篇小说并保存至: {}", file_path.display()))
    } else {
        // Long novel
        let mut chapters = Vec::new();
        let a_sel = Selector::parse("a.chapter-item-title").unwrap();
        for a in document.select(&a_sel) {
            let title = a.text().collect::<String>().trim().to_string();
            let href = a.value().attr("href").unwrap_or("");
            let chapter_id = href.split('/').next_back().unwrap_or("").to_string();
            if !chapter_id.is_empty() && !title.is_empty()
                && !title.contains("最近更新") && !title.contains("开始阅读") {
                    chapters.push((title, chapter_id));
                }
        }

        if chapters.is_empty() {
            let all_a_sel = Selector::parse("a").unwrap();
            for a in document.select(&all_a_sel) {
                let title = a.text().collect::<String>().trim().to_string();
                let href = a.value().attr("href").unwrap_or("");
                if href.contains("/reader/") {
                    let chapter_id = href.split('/').next_back().unwrap_or("").to_string();
                    if !chapters.iter().any(|(_, id)| id == &chapter_id) {
                        chapters.push((title, chapter_id));
                    }
                }
            }
        }

        if chapters.is_empty() {
            return Err("未解析到任何章节目录。".to_string());
        }

        let safe_novel_name = sanitize_filename(&novel_name);
        let book_folder = target_path.join(&safe_novel_name);
        fs::create_dir_all(&book_folder).map_err(|e| format!("创建小说目录失败: {}", e))?;

        let mut catalog_md = format!(
            "# 《{}》章节目录\n\n**全部章节**: {} 章\n\n---\n\n",
            novel_name,
            chapters.len()
        );
        for (i, (title, _)) in chapters.iter().enumerate() {
            catalog_md.push_str(&format!("- 第{}章：{}\n", i + 1, title));
        }
        let catalog_path = book_folder.join("目录.md");
        fs::write(&catalog_path, catalog_md).map_err(|e| format!("保存目录失败: {}", e))?;

        let target_chapters: Vec<_> = chapters.into_iter().take(FIRST_CHAPTER_COUNT).collect();
        let mut success_count = 0;

        for (i, (title, chapter_id)) in target_chapters.into_iter().enumerate() {
            match fetch_chapter_content(&client, &chapter_id) {
                Ok((parsed_title, content)) => {
                    let mut final_title = parsed_title;
                    if final_title.is_empty() {
                        final_title = title;
                    }
                    let decrypted = decrypt_text(&content);
                    let cleaned = clean_html_content(&decrypted);

                    if cleaned.contains("暂无内容") || cleaned.is_empty() {
                        continue; // Skip failed
                    }

                    let md_content = format!(
                        "# {}\n\n**章节链接**: https://fanqienovel.com/reader/{}\n\n---\n\n{}",
                        final_title, chapter_id, cleaned
                    );
                    let padded_index = format!("{:04}", i + 1);
                    let file_name =
                        format!("{}_{}.md", padded_index, sanitize_filename(&final_title));
                    let file_path = book_folder.join(&file_name);

                    if fs::write(&file_path, md_content).is_ok() {
                        success_count += 1;
                    }
                }
                Err(_) => {
                    // Ignore individual chapter errors to proceed with others
                }
            }
            std::thread::sleep(Duration::from_millis(300));
        }

        Ok(format!(
            "成功抓取《{}》前{}章及目录，存至: {}",
            novel_name,
            success_count,
            book_folder.display()
        ))
    }
}

fn fetch_chapter_content(client: &Client, chapter_id: &str) -> Result<(String, String), String> {
    let url = format!("https://fanqienovel.com/reader/{}", chapter_id);
    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Req err: {}", e))?;
    let html = response.text().map_err(|e| format!("Read err: {}", e))?;

    if html.len() < 5000 || !html.contains("window.__INITIAL_STATE__") {
        return Err("滑块拦截".to_string());
    }

    if let Some(title_start) = html.find("<title>") {
        if let Some(title_end) = html[title_start..].find("</title>") {
            let title = &html[title_start..title_start + title_end];
            let title_lower = title.to_lowercase();
            if title_lower.contains("验证")
                || title_lower.contains("captcha")
                || title_lower.contains("安全")
            {
                return Err("滑块拦截".to_string());
            }
        }
    }

    let start_marker = "window.__INITIAL_STATE__ =";
    let start_marker2 = "window.__INITIAL_STATE__=";

    let start_idx = html.find(start_marker).or_else(|| html.find(start_marker2));
    if let Some(idx) = start_idx {
        if let Some(brace_idx) = html[idx..].find('{') {
            let json_str = &html[idx + brace_idx..];
            let re = Regex::new(r":\s*undefined\b").unwrap();
            let cleaned_json = re.replace_all(json_str, ":null").to_string();

            let mut stream = serde_json::Deserializer::from_str(&cleaned_json).into_iter::<Value>();
            if let Some(Ok(data)) = stream.next() {
                let content = data["reader"]["chapterData"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let title = data["reader"]["chapterData"]["title"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                return Ok((title, content));
            }
        }
    }

    // Fallback to API
    let api_url = format!(
        "https://fanqienovel.com/api/reader/full?itemId={}",
        chapter_id
    );
    if let Ok(response) = client.get(&api_url).send() {
        if let Ok(data) = response.json::<Value>() {
            let content = data["data"]["chapterData"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let title = data["data"]["chapterData"]["title"]
                .as_str()
                .unwrap_or("")
                .to_string();
            return Ok((title, content));
        }
    }

    Err("无法提取章节内容".to_string())
}
