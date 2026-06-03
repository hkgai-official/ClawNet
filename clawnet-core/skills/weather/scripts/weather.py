#!/usr/bin/env python3
"""
天气查询工具
查询指定城市的当前天气情况
"""

import sys
import json
from datetime import datetime

# 检查requests库是否安装
try:
    import requests
except ImportError:
    print("错误：requests库未安装")
    print("请运行以下命令安装：")
    print("  pip install requests")
    print("或")
    print("  pip3 install requests")
    print("如果需要全局安装，请添加 --user 参数")
    sys.exit(1)

# 城市经纬度映射（中国主要城市）
CITY_COORDINATES = {
    "北京": {"latitude": 39.9042, "longitude": 116.4074, "name": "北京"},
    "上海": {"latitude": 31.2304, "longitude": 121.4737, "name": "上海"},
    "广州": {"latitude": 23.1291, "longitude": 113.2644, "name": "广州"},
    "深圳": {"latitude": 22.5431, "longitude": 114.0579, "name": "深圳"},
    "杭州": {"latitude": 30.2741, "longitude": 120.1551, "name": "杭州"},
    "南京": {"latitude": 32.0603, "longitude": 118.7969, "name": "南京"},
    "成都": {"latitude": 30.5728, "longitude": 104.0668, "name": "成都"},
    "重庆": {"latitude": 29.5630, "longitude": 106.5516, "name": "重庆"},
    "武汉": {"latitude": 30.5928, "longitude": 114.3055, "name": "武汉"},
    "西安": {"latitude": 34.3416, "longitude": 108.9398, "name": "西安"},
    "天津": {"latitude": 39.3434, "longitude": 117.3616, "name": "天津"},
    "苏州": {"latitude": 31.2989, "longitude": 120.5853, "name": "苏州"},
    "郑州": {"latitude": 34.7466, "longitude": 113.6253, "name": "郑州"},
    "长沙": {"latitude": 28.2282, "longitude": 112.9388, "name": "长沙"},
    "合肥": {"latitude": 31.8206, "longitude": 117.2272, "name": "合肥"},
    "济南": {"latitude": 36.6512, "longitude": 117.1200, "name": "济南"},
    "沈阳": {"latitude": 41.8057, "longitude": 123.4315, "name": "沈阳"},
    "大连": {"latitude": 38.9140, "longitude": 121.6147, "name": "大连"},
    "青岛": {"latitude": 36.0671, "longitude": 120.3826, "name": "青岛"},
    "厦门": {"latitude": 24.4798, "longitude": 118.0894, "name": "厦门"},
    "香港": {"latitude": 22.3193, "longitude": 114.1694, "name": "香港"},
    "澳门": {"latitude": 22.1987, "longitude": 113.5439, "name": "澳门"},
    "台北": {"latitude": 25.0330, "longitude": 121.5654, "name": "台北"},
    "汕头": {"latitude": 23.3541, "longitude": 116.6820, "name": "汕头"},
}

# 天气代码转换表（根据Open-Meteo文档）
WEATHER_CODES = {
    0: "晴朗",
    1: "基本晴朗",
    2: "局部多云",
    3: "多云",
    45: "有雾",
    48: "沉积雾",
    51: "轻度细雨",
    53: "中度细雨",
    55: "密集细雨",
    56: "轻度冻细雨",
    57: "密集冻细雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "轻度冻雨",
    67: "重度冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "中阵雨",
    82: "大阵雨",
    85: "小阵雪",
    86: "大阵雪",
    95: "雷暴",
    96: "轻度雷暴加冰雹",
    99: "重度雷暴加冰雹",
}

# 风向度数转换为方向描述
def wind_direction_to_text(degrees):
    """将风向度数转换为中文方向描述"""
    directions = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
    index = round(degrees / 45) % 8
    return directions[index]

def geocode_city(city_name):
    """使用Open-Meteo地理编码API获取城市坐标"""
    try:
        print(f"正在查找 '{city_name}' 的位置...")
        url = "https://geocoding-api.open-meteo.com/v1/search"
        params = {
            "name": city_name,
            "count": 10,  # 最多返回10个结果
            "language": "zh",
            "format": "json"
        }

        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()

        data = response.json()

        if "results" not in data or len(data["results"]) == 0:
            # 如果没有结果，尝试用英文查询（针对中文城市名）
            if any('\u4e00' <= c <= '\u9fff' for c in city_name):  # 检查是否包含中文字符
                print(f"中文查询无结果，尝试拼音/英文查询...")
                # 这里可以添加拼音转换，但先简单重试
                pass
            print(f"未找到城市 '{city_name}' 的位置信息")
            return None

        results = data["results"]

        # 知名国际城市映射（查询名 -> 预期国家代码）
        MAJOR_CITIES = {
            "tokyo": "JP",      # 日本东京
            "new york": "US",   # 美国纽约
            "new york city": "US",
            "london": "GB",     # 英国伦敦
            "paris": "FR",      # 法国巴黎
            "sydney": "AU",     # 澳大利亚悉尼
            "berlin": "DE",     # 德国柏林
            "rome": "IT",       # 意大利罗马
            "moscow": "RU",     # 俄罗斯莫斯科
            "seoul": "KR",      # 韩国首尔
            "singapore": "SG",  # 新加坡
            "bangkok": "TH",    # 泰国曼谷
            "delhi": "IN",      # 印度德里
            "mumbai": "IN",     # 印度孟买
            "cairo": "EG",      # 埃及开罗
            "rio de janeiro": "BR",  # 巴西里约热内卢
            "mexico city": "MX",     # 墨西哥城
            "toronto": "CA",         # 加拿大多伦多
        }

        # 对结果进行评分排序
        def score_result(result, query):
            score = 0

            # 名称匹配度（最重要）
            name = result.get("name", "").lower()
            query_lower = query.lower()

            if name == query_lower:
                score += 100  # 完全匹配
            elif query_lower in name:
                score += 50   # 包含查询词
            elif name in query_lower:
                score += 30   # 查询词包含名称

            # 知名城市优先匹配
            if query_lower in MAJOR_CITIES:
                expected_country = MAJOR_CITIES[query_lower]
                actual_country = result.get("country_code", "").upper()
                if actual_country == expected_country:
                    score += 80  # 知名城市正确匹配（非常高的加分）
                elif actual_country != expected_country:
                    score -= 40  # 知名城市错误匹配（惩罚）

            # 人口优先（如果存在）
            population = result.get("population", 0)
            if population > 5000000:  # 500万人口以上（超大都市）
                score += 60
            elif population > 1000000:  # 百万人口以上
                score += 40
            elif population > 500000:  # 五十万人口以上
                score += 25
            elif population > 100000:  # 十万人口以上
                score += 15
            elif population > 0:
                score += 5

            # 中国城市优先（针对中文查询）
            if any('\u4e00' <= c <= '\u9fff' for c in query):
                if result.get("country_code", "").upper() == "CN":
                    score += 30

            # 行政等级（如果存在）
            feature_code = result.get("feature_code", "")
            if feature_code == "PPLC":  # 首都
                score += 50
            elif feature_code == "PPLA":  # 一级行政中心
                score += 35
            elif feature_code in ["PPLA2", "PPLA3", "PPLA4"]:  # 二三四级行政中心
                score += 20
            elif feature_code == "PPL":  # 普通城市
                score += 10

            return score

        # 计算每个结果的得分并排序
        scored_results = []
        for result in results:
            score = score_result(result, city_name)
            scored_results.append((score, result))

        # 按分数降序排序
        scored_results.sort(key=lambda x: x[0], reverse=True)

        if not scored_results:
            print(f"未找到合适的匹配结果")
            return None

        # 选择最高分的结果
        best_score, best_result = scored_results[0]

        # 显示匹配信息（调试用）
        if len(scored_results) > 1:
            print(f"找到 {len(scored_results)} 个匹配，选择：{best_result['name']} (评分: {best_score})")
        else:
            print(f"找到：{best_result['name']}")

        return {
            "latitude": best_result["latitude"],
            "longitude": best_result["longitude"],
            "name": best_result["name"],
            "country": best_result.get("country", "未知"),
            "admin1": best_result.get("admin1", "未知")  # 省份/州
        }

    except requests.exceptions.RequestException as e:
        print(f"地理编码请求错误：{e}")
        return None
    except Exception as e:
        print(f"地理编码解析错误：{e}")
        return None

def get_weather(city_name="北京"):
    """获取指定城市的天气信息"""
    # 查找城市坐标（先检查预设字典）
    city = CITY_COORDINATES.get(city_name)
    if not city:
        # 尝试模糊匹配，比如用户输入"北京市"或"上海天气"
        for key in CITY_COORDINATES:
            if key in city_name or city_name in key:
                city = CITY_COORDINATES[key]
                break

    # 如果预设字典中没有找到，尝试地理编码
    if not city:
        geocode_result = geocode_city(city_name)

        # 如果地理编码失败，尝试对中文城市名添加"市"后缀
        if not geocode_result and any('\u4e00' <= c <= '\u9fff' for c in city_name):
            if not city_name.endswith(('市', '县', '区')):
                retry_name = city_name + '市'
                print(f"尝试添加'市'后缀查询: '{retry_name}'")
                geocode_result = geocode_city(retry_name)

        if not geocode_result:
            print(f"错误：无法找到城市 '{city_name}' 的位置")
            print("提示：")
            print("1. 请确认城市名称是否正确")
            print("2. 对于中国城市，可尝试添加'市'后缀（如'昆明市'）")
            print("3. 或尝试使用拼音/英文名称（如'Kunming'）")
            print("4. 国际城市请使用英文名称（如'New York City'）")
            return None

        # 使用地理编码结果
        city = {
            "latitude": geocode_result["latitude"],
            "longitude": geocode_result["longitude"],
            "name": geocode_result["name"]
        }
        print(f"找到位置：{geocode_result['name']}, {geocode_result.get('admin1', '')}, {geocode_result.get('country', '')}")

    # 构建API请求URL
    url = f"https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": city["latitude"],
        "longitude": city["longitude"],
        "current_weather": "true",
        "timezone": "auto"
    }

    try:
        print(f"正在查询 {city['name']} 的天气...")
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()

        data = response.json()

        if "current_weather" not in data:
            print("错误：API返回数据格式异常")
            return None

        current = data["current_weather"]

        # 解析数据
        temperature = current["temperature"]
        windspeed = current["windspeed"]
        winddirection = current["winddirection"]
        weathercode = current["weathercode"]
        is_day = current["is_day"]
        time_str = current["time"]

        # 转换天气代码
        weather_desc = WEATHER_CODES.get(weathercode, "未知")

        # 转换风向
        wind_dir = wind_direction_to_text(winddirection)

        # 解析时间
        try:
            update_time = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            time_str = update_time.strftime("%Y年%m月%d日 %H:%M")
        except:
            pass

        # 生成结果
        result = {
            "城市": city["name"],
            "温度": f"{temperature}°C",
            "天气状况": weather_desc,
            "风速": f"{windspeed} km/h",
            "风向": f"{wind_dir}风 ({winddirection}°)",
            "更新时间": time_str,
            "昼夜": "白天" if is_day == 1 else "夜晚"
        }

        return result

    except requests.exceptions.RequestException as e:
        print(f"网络请求错误：{e}")
        return None
    except json.JSONDecodeError as e:
        print(f"JSON解析错误：{e}")
        return None
    except Exception as e:
        print(f"未知错误：{e}")
        return None

def format_output(weather_data):
    """格式化输出天气信息"""
    if not weather_data:
        return "无法获取天气信息"

    output = f"🌤️  {weather_data['城市']} 当前天气\n"
    output += "=" * 30 + "\n"
    output += f"🌡️  温度：{weather_data['温度']}\n"
    output += f"☁️  天气：{weather_data['天气状况']}\n"
    output += f"💨  风速：{weather_data['风速']}\n"
    output += f"🧭  风向：{weather_data['风向']}\n"
    output += f"🌓  昼夜：{weather_data['昼夜']}\n"
    output += f"🕐  更新：{weather_data['更新时间']}\n"
    output += "=" * 30

    return output

def main():
    """主函数"""
    # 优先从标准输入读取参数（更安全，防止shell注入）
    import select
    city_input = None

    # 检查标准输入是否有数据（非阻塞检查）
    if select.select([sys.stdin], [], [], 0.0)[0]:
        # 从标准输入读取
        try:
            city_input = sys.stdin.read().strip()
        except Exception as e:
            print(f"读取标准输入错误：{e}")

    # 如果没有从标准输入读取到数据，则使用命令行参数
    if not city_input:
        if len(sys.argv) > 1:
            # 合并所有参数作为城市名（支持带空格的名称）
            city_input = " ".join(sys.argv[1:])
        else:
            city_input = "北京"

    # 如果输入为空，使用默认
    if not city_input:
        city_input = "北京"

    # 移除可能的中文标点（无论输入来源）
    city_input = city_input.replace("天气", "").replace("怎么样", "").replace("如何", "").strip()

    print(f"查询城市：{city_input}")

    # 获取天气信息
    weather_data = get_weather(city_input)

    if weather_data:
        # 格式化输出
        output = format_output(weather_data)
        print(output)

        # 返回给Claude的简洁版本
        print("\n📋 简洁摘要：")
        print(f"{weather_data['城市']}：{weather_data['温度']}，{weather_data['天气状况']}，{weather_data['风速']} {weather_data['风向']}")
    else:
        print("天气查询失败，请检查网络连接或城市名称")

if __name__ == "__main__":
    main()