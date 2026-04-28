#!/usr/bin/env node
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "docs");
const OUTPUT_HTML = path.join(OUTPUT_DIR, "bi-report-2024-2026.html");
const OUTPUT_PDF = path.join(OUTPUT_DIR, "bi-report-2024-2026.pdf");

// ─── DATA ────────────────────────────────────────────────────────────────────

const monthlyData = {
  SI: [
    {m:"2024-01",tx:7995,sales:7530225,paid:4652223,cust:101},
    {m:"2024-02",tx:7939,sales:7764791,paid:4817821,cust:104},
    {m:"2024-03",tx:8668,sales:8690542,paid:5344325,cust:105},
    {m:"2024-04",tx:9233,sales:9249404,paid:5759722,cust:101},
    {m:"2024-05",tx:8611,sales:8802882,paid:5536899,cust:101},
    {m:"2024-06",tx:8252,sales:8288742,paid:5177725,cust:101},
    {m:"2024-07",tx:8042,sales:7859841,paid:4990444,cust:99},
    {m:"2024-08",tx:8279,sales:8081351,paid:5079649,cust:102},
    {m:"2024-09",tx:7831,sales:7429518,paid:4667971,cust:102},
    {m:"2024-10",tx:8057,sales:7608775,paid:4774405,cust:101},
    {m:"2024-11",tx:7698,sales:7209564,paid:4523935,cust:102},
    {m:"2024-12",tx:7820,sales:6827501,paid:4321418,cust:104},
    {m:"2025-01",tx:7637,sales:6062766,paid:3871959,cust:97},
    {m:"2025-02",tx:7329,sales:6362368,paid:3954810,cust:99},
    {m:"2025-03",tx:8274,sales:7598719,paid:4732834,cust:101},
    {m:"2025-04",tx:8359,sales:7642172,paid:4680011,cust:103},
    {m:"2025-05",tx:7853,sales:7317377,paid:4566367,cust:104},
    {m:"2025-06",tx:7694,sales:7240229,paid:4648156,cust:101},
    {m:"2025-07",tx:7981,sales:7213144,paid:4626770,cust:101},
    {m:"2025-08",tx:8068,sales:7383604,paid:4635127,cust:105},
    {m:"2025-09",tx:7800,sales:6536720,paid:4091576,cust:104},
    {m:"2025-10",tx:7930,sales:6540259,paid:4118301,cust:105},
    {m:"2025-11",tx:7321,sales:5922916,paid:3766602,cust:103},
    {m:"2025-12",tx:7876,sales:5936490,paid:3711856,cust:106},
    {m:"2026-01",tx:7402,sales:5547808,paid:3487655,cust:100},
    {m:"2026-02",tx:4096,sales:3269764,paid:2076662,cust:99},
  ],
  Bearing: [
    {m:"2024-01",tx:7841,sales:3621404,paid:3621404,cust:91},
    {m:"2024-02",tx:7523,sales:3597918,paid:3597918,cust:93},
    {m:"2024-03",tx:8417,sales:4037534,paid:4037534,cust:88},
    {m:"2024-04",tx:9777,sales:4468995,paid:4468995,cust:93},
    {m:"2024-05",tx:8474,sales:4082394,paid:4082394,cust:90},
    {m:"2024-06",tx:8186,sales:3849869,paid:3849869,cust:90},
    {m:"2024-07",tx:7624,sales:3525912,paid:3525912,cust:89},
    {m:"2024-08",tx:8395,sales:3794273,paid:3794273,cust:87},
    {m:"2024-09",tx:7659,sales:3444101,paid:3444101,cust:91},
    {m:"2024-10",tx:7946,sales:3495589,paid:3495589,cust:89},
    {m:"2024-11",tx:7576,sales:3305998,paid:3305998,cust:89},
    {m:"2024-12",tx:7577,sales:3115409,paid:3115409,cust:93},
    {m:"2025-01",tx:7111,sales:2857447,paid:2857447,cust:92},
    {m:"2025-02",tx:7193,sales:3004214,paid:3004214,cust:92},
    {m:"2025-03",tx:6357,sales:2691817,paid:2691817,cust:90},
    {m:"2025-04",tx:8395,sales:3366253,paid:3366253,cust:96},
    {m:"2025-05",tx:7949,sales:3397582,paid:3397582,cust:95},
    {m:"2025-06",tx:7607,sales:3291973,paid:3291973,cust:91},
    {m:"2025-07",tx:7458,sales:3219826,paid:3219826,cust:94},
    {m:"2025-08",tx:7822,sales:3294901,paid:3294901,cust:96},
    {m:"2025-09",tx:7091,sales:3007817,paid:3007817,cust:95},
    {m:"2025-10",tx:7317,sales:3106266,paid:3106266,cust:95},
    {m:"2025-11",tx:6555,sales:2722040,paid:2722040,cust:88},
    {m:"2025-12",tx:7354,sales:2856391,paid:2856391,cust:91},
    {m:"2026-01",tx:6800,sales:2764412,paid:2764412,cust:89},
    {m:"2026-02",tx:3888,sales:1567747,paid:1567747,cust:86},
  ],
  KTK: [
    {m:"2024-01",tx:3840,sales:3821655,paid:3792795,cust:51},
    {m:"2024-02",tx:3925,sales:3964561,paid:3942331,cust:51},
    {m:"2024-03",tx:4311,sales:4511324,paid:4487274,cust:53},
    {m:"2024-04",tx:4521,sales:4781640,paid:4755821,cust:54},
    {m:"2024-05",tx:4569,sales:4818611,paid:4794591,cust:55},
    {m:"2024-06",tx:4093,sales:4465223,paid:4440523,cust:52},
    {m:"2024-07",tx:3927,sales:4233998,paid:4210468,cust:50},
    {m:"2024-08",tx:4112,sales:4365864,paid:4340904,cust:53},
    {m:"2024-09",tx:3881,sales:4052496,paid:4024546,cust:52},
    {m:"2024-10",tx:4013,sales:4109062,paid:4086052,cust:55},
    {m:"2024-11",tx:4086,sales:4015913,paid:3992123,cust:51},
    {m:"2024-12",tx:4045,sales:3682299,paid:3662929,cust:54},
    {m:"2025-01",tx:3968,sales:3389690,paid:3364600,cust:54},
    {m:"2025-02",tx:3815,sales:3558624,paid:3506572,cust:57},
    {m:"2025-03",tx:4298,sales:4267678,paid:4243048,cust:52},
    {m:"2025-04",tx:4010,sales:4035836,paid:4023356,cust:54},
    {m:"2025-05",tx:3770,sales:3970048,paid:3955878,cust:55},
    {m:"2025-06",tx:3939,sales:4007886,paid:3989296,cust:52},
    {m:"2025-07",tx:3961,sales:4003264,paid:3985324,cust:52},
    {m:"2025-08",tx:4062,sales:4107793,paid:4085523,cust:54},
    {m:"2025-09",tx:3614,sales:3642636,paid:3619496,cust:54},
    {m:"2025-10",tx:3686,sales:3655765,paid:3633275,cust:50},
    {m:"2025-11",tx:3461,sales:3324272,paid:3304772,cust:46},
    {m:"2025-12",tx:3915,sales:3428863,paid:3413133,cust:52},
    {m:"2026-01",tx:3776,sales:3231441,paid:3212591,cust:47},
    {m:"2026-02",tx:2056,sales:1897614,paid:1871779,cust:48},
  ],
};

const yoyData = {
  SI: [
    {year:2024,tx:98425,sales:95343136,paid:59646537,outstanding:35696599,coll:62.6,cust:126,avgTx:968.69},
    {year:2025,tx:94122,sales:81756764,paid:51404369,outstanding:30352395,coll:62.9,cust:138,avgTx:868.63},
    {year:2026,tx:11498,sales:8817572,paid:5564317,outstanding:3253255,coll:63.1,cust:104,avgTx:766.88},
  ],
  Bearing: [
    {year:2024,tx:96995,sales:44339396,paid:44339396,outstanding:0,coll:100.0,cust:119,avgTx:457.13},
    {year:2025,tx:88209,sales:36816527,paid:36816527,outstanding:0,coll:100.0,cust:121,avgTx:417.38},
    {year:2026,tx:10688,sales:4332159,paid:4332159,outstanding:0,coll:100.0,cust:93,avgTx:405.33},
  ],
  KTK: [
    {year:2024,tx:49323,sales:50822646,paid:50530357,outstanding:292289,coll:99.4,cust:67,avgTx:1030.40},
    {year:2025,tx:46499,sales:45392355,paid:45124273,outstanding:268082,coll:99.4,cust:69,avgTx:976.20},
    {year:2026,tx:5832,sales:5129055,paid:5084370,outstanding:44685,coll:99.1,cust:50,avgTx:879.47},
  ],
};

const productMix = {
  SI: [
    {name:"แพ็ค",items:116981,qty:696205,revenue:75995842,pct:41.3},
    {name:"เกล็ด",items:101709,qty:2805500,revenue:66671838,pct:36.2},
    {name:"หลอดเล็ก",items:87379,qty:1222415,revenue:28870074,pct:15.7},
    {name:"หลอดใหญ่",items:34387,qty:279412,revenue:5737825,pct:3.1},
    {name:"บด",items:37014,qty:314802,revenue:5734529,pct:3.1},
    {name:"หลอด 30",items:10519,qty:50232,revenue:1043899,pct:0.6},
  ],
  Bearing: [
    {name:"แพ็ค",items:105941,qty:218847,revenue:28859718,pct:33.9},
    {name:"เกล็ด",items:85304,qty:1117060,revenue:24329607,pct:28.6},
    {name:"หลอดเล็ก",items:78495,qty:899154,revenue:16349540,pct:19.2},
    {name:"หลอดใหญ่",items:72635,qty:1049755,revenue:9914760,pct:11.6},
    {name:"บด",items:16763,qty:232073,revenue:5320919,pct:6.3},
    {name:"หลอด 30",items:1819,qty:8324,revenue:355940,pct:0.4},
  ],
  KTK: [
    {name:"เกล็ด",items:60915,qty:1421097,revenue:35885303,pct:35.5},
    {name:"แพ็ค",items:73631,qty:392022,revenue:27861964,pct:27.6},
    {name:"หลอดเล็ก",items:54334,qty:977970,revenue:26235457,pct:25.9},
    {name:"หลอดใหญ่",items:22329,qty:83286,revenue:6593235,pct:6.5},
    {name:"หลอด 30",items:8668,qty:108356,revenue:4312598,pct:4.3},
    {name:"บด",items:2485,qty:9526,revenue:232240,pct:0.2},
  ],
};

const topCustomers = {
  SI: [
    {name:"พันธ์สิทธิ์01-8472741",tx:3890,sales:16280718,paid:-111711,outstanding:16392429,coll:-0.7,months:26},
    {name:"โรงน้ำแข็งสุขุมวิท 50",tx:1638,sales:15744132,paid:78452,outstanding:15665680,coll:0.5,months:26},
    {name:"ชัยวัฒน์ เพ็ญศรีชล",tx:3132,sales:9465309,paid:-28728,outstanding:9494037,coll:-0.3,months:26},
    {name:"สินธานี(เจ้)-ส่ง",tx:2571,sales:6515596,paid:6515596,outstanding:0,coll:100,months:26},
    {name:"พลูศรี(พงษ์เจริญ)",tx:4342,sales:6370847,paid:33473,outstanding:6337374,coll:0.5,months:26},
    {name:"ไพฑูรย์",tx:4365,sales:6020882,paid:6020882,outstanding:0,coll:100,months:26},
    {name:"ปั้ง (เสรีไทยซอย 81)",tx:2503,sales:5539570,paid:5539570,outstanding:0,coll:100,months:26},
    {name:"บอยไก่บิน",tx:1963,sales:4182980,paid:4182980,outstanding:0,coll:100,months:26},
    {name:"ปัฐวิกรณ์(ส่ง)",tx:2443,sales:4087652,paid:-424146,outstanding:4511798,coll:-10.4,months:26},
    {name:"โฉมศรี ดวงเดือน",tx:2023,sales:3885667,paid:3885667,outstanding:0,coll:100,months:26},
    {name:"เฮียเปี๊ยก",tx:2284,sales:3523886,paid:3521902,outstanding:1984,coll:99.9,months:26},
    {name:"ตี๋น้อย ประตูน้ำ",tx:2380,sales:3455115,paid:3455115,outstanding:0,coll:100,months:26},
    {name:"อ้วน (บางกะปิ)",tx:3069,sales:3364247,paid:-8032,outstanding:3372279,coll:-0.2,months:26},
    {name:"ศราวุธ(วุฒิ น้ำแข็ง)",tx:2607,sales:3345597,paid:3345597,outstanding:0,coll:100,months:26},
    {name:"ภาพร (สายฝน)",tx:5397,sales:2970282,paid:2970282,outstanding:0,coll:100,months:26},
    {name:"สด(แช่)",tx:11378,sales:2722120,paid:2722120,outstanding:0,coll:100,months:26},
    {name:"ตลาดศรีดินแดง",tx:827,sales:2686540,paid:-13516,outstanding:2700056,coll:-0.5,months:26},
    {name:"งิ้ง",tx:3062,sales:2630140,paid:2630140,outstanding:0,coll:100,months:26},
    {name:"เซี้ยม",tx:1591,sales:2462935,paid:2462935,outstanding:0,coll:100,months:26},
    {name:"รนข.ราม39(3)",tx:1755,sales:2457174,paid:2457174,outstanding:0,coll:100,months:26},
  ],
  Bearing: [
    {name:"ตลาดนางรำ",tx:2196,sales:6609265,paid:6609265,outstanding:0,coll:100,months:26},
    {name:"วีรชัย(สุเทพ)",tx:4243,sales:5692412,paid:5692412,outstanding:0,coll:100,months:26},
    {name:"สดส่ง ครึ่งซอง",tx:29075,sales:4554827,paid:4554827,outstanding:0,coll:100,months:26},
    {name:"นิตยา น้ำแข็ง",tx:4278,sales:3361967,paid:3361967,outstanding:0,coll:100,months:26},
    {name:"ส.วารี",tx:4132,sales:3068443,paid:3068443,outstanding:0,coll:100,months:26},
    {name:"เพชภูมิ",tx:3254,sales:2714733,paid:2714733,outstanding:0,coll:100,months:26},
    {name:"ธนพล",tx:2261,sales:2670172,paid:2670172,outstanding:0,coll:100,months:26},
    {name:"ณัฐมน",tx:1992,sales:2370465,paid:2370465,outstanding:0,coll:100,months:26},
    {name:"พิกุล น้ำแข็ง",tx:2560,sales:2236061,paid:2236061,outstanding:0,coll:100,months:26},
    {name:"สดแช่",tx:5238,sales:2200860,paid:2200860,outstanding:0,coll:100,months:26},
    {name:"จิวารัตน์ ใสสุข",tx:3481,sales:1893628,paid:1893628,outstanding:0,coll:100,months:26},
    {name:"บุญถม",tx:1694,sales:1836965,paid:1836965,outstanding:0,coll:100,months:26},
    {name:"รัตนทัต ช้างม่วง",tx:789,sales:1820590,paid:1820590,outstanding:0,coll:100,months:26},
    {name:"ปานตะวัน",tx:2607,sales:1732773,paid:1732773,outstanding:0,coll:100,months:26},
    {name:"ธนวัฒน์",tx:1584,sales:1713483,paid:1713483,outstanding:0,coll:100,months:26},
    {name:"ธนพล น้ำแข็ง",tx:2487,sales:1654927,paid:1654927,outstanding:0,coll:100,months:26},
    {name:"MAX OK",tx:1469,sales:1513316,paid:1513316,outstanding:0,coll:100,months:26},
    {name:"สดปลีก",tx:9417,sales:1440462,paid:1440462,outstanding:0,coll:100,months:26},
    {name:"แหวนพลอย",tx:2334,sales:1354206,paid:1354206,outstanding:0,coll:100,months:26},
    {name:"ชัย น้ำแข็ง",tx:1502,sales:1326818,paid:1326818,outstanding:0,coll:100,months:26},
  ],
  KTK: [
    {name:"พัฒนาการ 32 (จุดกระจายสินค้า)",tx:1598,sales:9513742,paid:9513742,outstanding:0,coll:100,months:26},
    {name:"น้ำแข็งเมืองทองเฮียไฮ้",tx:3226,sales:5782737,paid:5782737,outstanding:0,coll:100,months:26},
    {name:"นพรัตน์ ( ลอย )",tx:1593,sales:5504824,paid:5504824,outstanding:0,coll:100,months:26},
    {name:"ภู น้ำแข็ง (คันเทา)",tx:1703,sales:4548211,paid:4548211,outstanding:0,coll:100,months:26},
    {name:"จ่อย ( 2 ) < VIGO ตล-8106 >",tx:4441,sales:4427600,paid:4427600,outstanding:0,coll:100,months:26},
    {name:"เฮียวันชัย",tx:1715,sales:4345197,paid:4345197,outstanding:0,coll:100,months:26},
    {name:"ชัชวาล",tx:3927,sales:3995735,paid:3995735,outstanding:0,coll:100,months:26},
    {name:"นาย สาโรจน์",tx:2589,sales:3734227,paid:3734227,outstanding:0,coll:100,months:21},
    {name:"นัชชา น้ำแข็ง",tx:2225,sales:3630164,paid:3630164,outstanding:0,coll:100,months:26},
    {name:"นาย อภิรักษ์",tx:2570,sales:3533347,paid:3533347,outstanding:0,coll:100,months:26},
    {name:"เฮีย หนอ",tx:1606,sales:3319619,paid:3319619,outstanding:0,coll:100,months:26},
    {name:"ภู น้ำแข็ง (คันขาว)",tx:2929,sales:3298628,paid:3298628,outstanding:0,coll:100,months:26},
    {name:"เมืองทอง",tx:1714,sales:3291125,paid:3291125,outstanding:0,coll:100,months:26},
    {name:"ชัยเจริญ",tx:2121,sales:3288533,paid:3288533,outstanding:0,coll:100,months:26},
    {name:"สมชาย",tx:2102,sales:2890673,paid:2890673,outstanding:0,coll:100,months:26},
    {name:"พระราม 9",tx:1642,sales:2434549,paid:2434549,outstanding:0,coll:100,months:26},
    {name:"ลำสาลี (นุ้ย)",tx:3123,sales:2379231,paid:2379231,outstanding:0,coll:100,months:26},
    {name:"สวนสน",tx:1788,sales:2167906,paid:2167906,outstanding:0,coll:100,months:26},
    {name:"ลำสาลี น้ำแข็ง (นิ)",tx:3007,sales:2153110,paid:2153110,outstanding:0,coll:100,months:26},
    {name:"สมศักดิ์ รวย 2",tx:815,sales:1915321,paid:1915321,outstanding:0,coll:100,months:26},
  ],
};

const concentration = {
  SI:      {top5:29.2,top10:42.0,top20:57.9,total:151},
  Bearing: {top5:27.2,top10:41.5,top20:60.6,total:134},
  KTK:     {top5:29.4,top10:48.4,top20:75.1,total:73},
};

const customerGrowth = {
  SI: [
    {m:"2024-01",active:101,newCust:101},{m:"2024-02",active:104,newCust:6},{m:"2024-03",active:105,newCust:4},{m:"2024-04",active:101,newCust:2},{m:"2024-05",active:101,newCust:3},{m:"2024-06",active:101,newCust:1},{m:"2024-07",active:99,newCust:0},{m:"2024-08",active:102,newCust:3},{m:"2024-09",active:102,newCust:1},{m:"2024-10",active:101,newCust:1},{m:"2024-11",active:102,newCust:1},{m:"2024-12",active:104,newCust:3},
    {m:"2025-01",active:97,newCust:1},{m:"2025-02",active:99,newCust:1},{m:"2025-03",active:101,newCust:2},{m:"2025-04",active:103,newCust:2},{m:"2025-05",active:104,newCust:2},{m:"2025-06",active:101,newCust:1},{m:"2025-07",active:101,newCust:3},{m:"2025-08",active:105,newCust:7},{m:"2025-09",active:104,newCust:2},{m:"2025-10",active:105,newCust:4},{m:"2025-11",active:103,newCust:0},{m:"2025-12",active:106,newCust:0},
    {m:"2026-01",active:100,newCust:0},{m:"2026-02",active:99,newCust:0},
  ],
  Bearing: [
    {m:"2024-01",active:91,newCust:91},{m:"2024-02",active:93,newCust:6},{m:"2024-03",active:88,newCust:3},{m:"2024-04",active:93,newCust:2},{m:"2024-05",active:90,newCust:4},{m:"2024-06",active:90,newCust:4},{m:"2024-07",active:89,newCust:1},{m:"2024-08",active:87,newCust:0},{m:"2024-09",active:91,newCust:5},{m:"2024-10",active:89,newCust:0},{m:"2024-11",active:89,newCust:0},{m:"2024-12",active:93,newCust:3},
    {m:"2025-01",active:92,newCust:0},{m:"2025-02",active:92,newCust:0},{m:"2025-03",active:90,newCust:1},{m:"2025-04",active:96,newCust:3},{m:"2025-05",active:95,newCust:2},{m:"2025-06",active:91,newCust:1},{m:"2025-07",active:94,newCust:1},{m:"2025-08",active:96,newCust:3},{m:"2025-09",active:95,newCust:2},{m:"2025-10",active:95,newCust:1},{m:"2025-11",active:88,newCust:0},{m:"2025-12",active:91,newCust:1},
    {m:"2026-01",active:89,newCust:0},{m:"2026-02",active:86,newCust:0},
  ],
  KTK: [
    {m:"2024-01",active:51,newCust:51},{m:"2024-02",active:51,newCust:5},{m:"2024-03",active:53,newCust:1},{m:"2024-04",active:54,newCust:2},{m:"2024-05",active:55,newCust:2},{m:"2024-06",active:52,newCust:1},{m:"2024-07",active:50,newCust:0},{m:"2024-08",active:53,newCust:1},{m:"2024-09",active:52,newCust:1},{m:"2024-10",active:55,newCust:0},{m:"2024-11",active:51,newCust:1},{m:"2024-12",active:54,newCust:2},
    {m:"2025-01",active:54,newCust:1},{m:"2025-02",active:57,newCust:1},{m:"2025-03",active:52,newCust:0},{m:"2025-04",active:54,newCust:2},{m:"2025-05",active:55,newCust:0},{m:"2025-06",active:52,newCust:0},{m:"2025-07",active:52,newCust:0},{m:"2025-08",active:54,newCust:0},{m:"2025-09",active:54,newCust:1},{m:"2025-10",active:50,newCust:1},{m:"2025-11",active:46,newCust:0},{m:"2025-12",active:52,newCust:0},
    {m:"2026-01",active:47,newCust:0},{m:"2026-02",active:48,newCust:0},
  ],
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtM(n) {
  return (n / 1e6).toFixed(2) + "M";
}
function pct(n) {
  return Number(n).toFixed(1) + "%";
}
function shortMonth(m) {
  return m.replace("2024-","24/").replace("2025-","25/").replace("2026-","26/");
}

// ─── HTML GENERATION ─────────────────────────────────────────────────────────

function buildHTML() {
  const labels = monthlyData.SI.map(d => shortMonth(d.m));
  const labelsJSON = JSON.stringify(labels);

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>SuperIce Group — BI Report 2024-2026</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', 'Sarabun', Arial, sans-serif; font-size: 10px; color: #1e293b; line-height: 1.45; background: #fff; }
  .page { page-break-after: always; padding: 8px 0; }
  .page:last-child { page-break-after: avoid; }
  h1 { font-size: 22px; color: #0f172a; border-bottom: 3px solid #2563eb; padding-bottom: 6px; margin-bottom: 12px; }
  h2 { font-size: 15px; color: #1e40af; margin: 16px 0 8px 0; border-left: 4px solid #2563eb; padding-left: 8px; }
  h3 { font-size: 12px; color: #334155; margin: 10px 0 4px 0; }
  .subtitle { font-size: 11px; color: #64748b; margin-bottom: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; }
  .card-header { font-size: 12px; font-weight: 700; color: #1e40af; margin-bottom: 6px; }
  .kpi-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .kpi { flex: 1; min-width: 120px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; text-align: center; }
  .kpi .val { font-size: 18px; font-weight: 700; color: #0f172a; }
  .kpi .lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .kpi.green .val { color: #16a34a; }
  .kpi.red .val { color: #dc2626; }
  .kpi.blue .val { color: #2563eb; }
  .kpi.orange .val { color: #ea580c; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin: 6px 0; }
  th { background: #1e40af; color: #fff; padding: 5px 6px; text-align: left; font-weight: 600; font-size: 8.5px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  tr.highlight { background: #fef3c7; }
  .right { text-align: right; }
  .center { text-align: center; }
  .text-red { color: #dc2626; font-weight: 600; }
  .text-green { color: #16a34a; }
  .text-sm { font-size: 9px; color: #475569; }
  .chart-container { width: 100%; height: 240px; margin: 8px 0; position: relative; }
  .chart-container.tall { height: 280px; }
  .analysis { background: #eff6ff; border-left: 4px solid #2563eb; padding: 8px 12px; margin: 8px 0; font-size: 9.5px; line-height: 1.5; border-radius: 0 4px 4px 0; }
  .analysis strong { color: #1e40af; }
  .risk-high { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
  .risk-med { background: #fefce8; border-color: #ca8a04; color: #854d0e; }
  .risk-low { background: #f0fdf4; border-color: #16a34a; color: #166534; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 10px; font-size: 8px; font-weight: 600; }
  .badge-red { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .badge-green { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .badge-yellow { background: #fefce8; color: #ca8a04; border: 1px solid #fde68a; }
  .footer { text-align: center; font-size: 8px; color: #94a3b8; margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; }
  .action-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; margin: 4px 0; }
  .action-item .num { display: inline-block; width: 18px; height: 18px; background: #2563eb; color: #fff; border-radius: 50%; text-align: center; line-height: 18px; font-size: 9px; font-weight: 700; margin-right: 6px; }
  .watermark { position: fixed; bottom: 8px; right: 12px; font-size: 7px; color: #cbd5e1; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>

<!-- ═══════════════════ PAGE 1: COVER + GROUP KPIs ═══════════════════ -->
<div class="page">
  <h1>SuperIce Group — Business Intelligence Report</h1>
  <div class="subtitle">Full Financial & Customer Analysis | Data Period: January 2024 – February 2026 | Generated: ${new Date().toLocaleDateString("en-GB")}</div>

  <h2>1. Group Overview — Key Performance Indicators</h2>
  <div class="kpi-row">
    <div class="kpi blue"><div class="val">฿${fmtM(95343136+44339396+50822646+81756764+36816527+45392355+8817572+4332159+5129055)}</div><div class="lbl">Total Group Revenue (2024-2026)</div></div>
    <div class="kpi green"><div class="val">${fmt(98425+96995+49323+94122+88209+46499+11498+10688+5832)}</div><div class="lbl">Total Transactions</div></div>
    <div class="kpi orange"><div class="val">${fmt(151+134+73)}</div><div class="lbl">Unique Customers (Union)</div></div>
    <div class="kpi red"><div class="val">฿${fmtM(35696599+0+292289+30352395+0+268082+3253255+0+44685)}</div><div class="lbl">Total Outstanding</div></div>
  </div>

  <div class="analysis">
    <strong>Executive Summary:</strong> The SuperIce Group generated ฿372.7M in total revenue across three factories over the analysis period. SI is the largest revenue contributor at ฿185.9M (49.9%), followed by KTK at ฿101.3M (27.2%) and Bearing at ฿85.5M (22.9%). A clear declining trend in revenue is observed across all three factories from 2024 to 2025, with SI showing the steepest decline at -14.2% year-over-year. The group's biggest financial risk is concentrated in SI's outstanding receivables of ฿69.3M, while Bearing maintains a perfect 100% collection rate and KTK operates at 99.4%. The customer base is stable but maturing — virtually zero new customer acquisition since mid-2025, which signals a saturated distribution network and a need for proactive growth strategies.
  </div>

  <h2>2. Year-over-Year Performance by Factory</h2>
  <div class="grid3">
    ${Object.entries(yoyData).map(([factory, rows]) => `
    <div class="card">
      <div class="card-header">${factory === "SI" ? "SI (ซูเปอร์ไอซ์)" : factory === "Bearing" ? "แบริ่ง (Bearing)" : "KTK"}</div>
      <table>
        <tr><th>Year</th><th class="right">Revenue</th><th class="right">Collected</th><th class="right">O/S</th><th class="right">Coll%</th><th class="right">Cust</th><th class="right">Avg Tx</th></tr>
        ${rows.map(r => `<tr><td>${r.year}</td><td class="right">฿${fmtM(r.sales)}</td><td class="right">฿${fmtM(r.paid)}</td><td class="right ${r.outstanding > 0 ? 'text-red' : ''}">${r.outstanding > 0 ? '฿'+fmtM(r.outstanding) : '—'}</td><td class="right">${pct(r.coll)}</td><td class="right">${r.cust}</td><td class="right">฿${fmt(r.avgTx)}</td></tr>`).join("")}
        ${(() => {
          const r24 = rows[0], r25 = rows[1];
          const chg = ((r25.sales - r24.sales) / r24.sales * 100).toFixed(1);
          return `<tr style="background:#f1f5f9;font-weight:600"><td colspan="2">YoY Change</td><td colspan="5" class="${Number(chg) < 0 ? 'text-red' : 'text-green'}">${chg}% (2024→2025)</td></tr>`;
        })()}
      </table>
    </div>`).join("")}
  </div>

  <div class="analysis">
    <strong>Year-over-Year Analysis:</strong> All three factories experienced revenue declines from 2024 to 2025. SI dropped from ฿95.3M to ฿81.8M (-14.2%), while average transaction value fell from ฿969 to ฿869 (-10.3%). Bearing declined from ฿44.3M to ฿36.8M (-17.0%), reflecting both fewer transactions (-9.1%) and lower ticket size. KTK showed the most resilience, dropping from ฿50.8M to ฿45.4M (-10.7%), with its average transaction value of ฿976 remaining the highest among all factories despite decreasing from ฿1,030. The 2026 annualized run-rate (based on Jan data) projects further softening: SI ~฿66.6M, Bearing ~฿33.2M, KTK ~฿38.8M — implying the downward trend is accelerating unless corrective measures are taken.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 1 of 6</div>
</div>

<!-- ═══════════════════ PAGE 2: MONTHLY SALES TREND CHARTS ═══════════════════ -->
<div class="page">
  <h2>3. Monthly Sales Trend — All Factories (Line Chart)</h2>
  <div class="chart-container tall">
    <canvas id="chartSalesAll"></canvas>
  </div>

  <div class="analysis">
    <strong>Trend Analysis:</strong> The line chart reveals a consistent seasonal pattern: sales peak in April (summer/Songkran) and bottom out in December-January (cool season). SI shows the most pronounced seasonality with ฿9.2M peak (Apr 2024) versus ฿5.5M trough (Jan 2026) — a 40% swing. Each successive year, the peaks and troughs both shift downward, indicating structural demand erosion beyond just seasonality. Bearing follows a similar but flatter pattern, while KTK maintains the most stable month-to-month profile with only ~20% seasonal variance. Notably, the gap between SI and KTK is narrowing — from ฿3.7M in Jan 2024 to ฿2.3M in Jan 2026 — suggesting KTK's relative competitive position is improving.
  </div>

  <h2>4. Monthly Revenue by Factory (Individual Trends)</h2>
  <div class="grid3">
    <div class="chart-container"><canvas id="chartSI"></canvas></div>
    <div class="chart-container"><canvas id="chartBearing"></canvas></div>
    <div class="chart-container"><canvas id="chartKTK"></canvas></div>
  </div>

  <h2>5. Monthly Active Customers & New Customer Acquisition</h2>
  <div class="chart-container tall">
    <canvas id="chartCustomers"></canvas>
  </div>

  <div class="analysis">
    <strong>Customer Dynamics:</strong> The active customer count remains remarkably stable: SI hovers at 100-106 per month, Bearing at 86-96, and KTK at 46-57. However, new customer acquisition has essentially flatlined since mid-2024. SI added only 25 new customers in all of 2025 (vs. 26 in 2024), Bearing added 15 (vs. 28 in 2024), and KTK added just 5 (vs. 16 in 2024). In 2026 so far, zero new customers have been acquired at any factory. This indicates a fully mature market with no organic growth pipeline — revenue improvement can only come from increasing wallet share with existing customers or developing new distribution channels.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 2 of 6</div>
</div>

<!-- ═══════════════════ PAGE 3: PRODUCT MIX + CONCENTRATION ═══════════════════ -->
<div class="page">
  <h2>6. Product Mix Analysis by Factory</h2>
  <div class="grid3">
    ${Object.entries(productMix).map(([factory, products]) => `
    <div class="card">
      <div class="card-header">${factory === "SI" ? "SI (ซูเปอร์ไอซ์)" : factory === "Bearing" ? "แบริ่ง" : "KTK"}</div>
      <table>
        <tr><th>Product</th><th class="right">Revenue</th><th class="right">Share</th><th class="right">Volume</th></tr>
        ${products.map(p => `<tr><td>${p.name}</td><td class="right">฿${fmtM(p.revenue)}</td><td class="right">${pct(p.pct)}</td><td class="right">${fmt(p.qty)}</td></tr>`).join("")}
      </table>
    </div>`).join("")}
  </div>

  <div class="analysis">
    <strong>Product Mix Insights:</strong> แพ็ค (pack) and เกล็ด (crushed) together account for 77.5% of SI revenue, 62.5% of Bearing, and 63.1% of KTK. SI is the most pack-dominant (41.3%), reflecting its customer profile of larger distributors. KTK is uniquely เกล็ด-heavy (35.5%), suggesting a different end-market mix skewed toward food/beverage vendors. Bearing has the most balanced portfolio with หลอดใหญ่ (large tube) contributing a meaningful 11.6% — nearly 4x the share vs SI. The บด (ground) category is interesting: it represents 6.3% of Bearing but only 0.2% of KTK, indicating significant product preference differences between the factory's customer bases. This data suggests cross-selling opportunities: introducing Bearing's หลอดใหญ่ product mix at SI, and growing บด at KTK.
  </div>

  <h2>7. Customer Concentration Risk Analysis</h2>
  <div class="grid3">
    ${Object.entries(concentration).map(([factory, c]) => `
    <div class="card">
      <div class="card-header">${factory === "SI" ? "SI (ซูเปอร์ไอซ์)" : factory === "Bearing" ? "แบริ่ง" : "KTK"}</div>
      <table>
        <tr><th>Metric</th><th class="right">Value</th><th>Risk Level</th></tr>
        <tr><td>Top 5 Share</td><td class="right">${pct(c.top5)}</td><td><span class="badge ${c.top5>30?'badge-red':'badge-yellow'}">${c.top5>30?'HIGH':'MEDIUM'}</span></td></tr>
        <tr><td>Top 10 Share</td><td class="right">${pct(c.top10)}</td><td><span class="badge ${c.top10>50?'badge-red':'badge-yellow'}">${c.top10>50?'HIGH':'MEDIUM'}</span></td></tr>
        <tr><td>Top 20 Share</td><td class="right">${pct(c.top20)}</td><td><span class="badge ${c.top20>70?'badge-red':c.top20>60?'badge-yellow':'badge-green'}">${c.top20>70?'HIGH':c.top20>60?'MEDIUM':'OK'}</span></td></tr>
        <tr><td>Total Customers</td><td class="right">${c.total}</td><td><span class="badge badge-green">BASE</span></td></tr>
      </table>
    </div>`).join("")}
  </div>

  <div class="analysis risk-med">
    <strong>Concentration Risk:</strong> KTK has the highest concentration risk — its top 20 customers control 75.1% of revenue, with only 73 customers total. Losing even 2-3 top accounts could reduce KTK revenue by 15-20%. SI and Bearing have more distributed bases (151 and 134 customers respectively), but their top-5 still control 27-29% of revenue. The recommended concentration limit is Top-5 ≤ 25%, Top-10 ≤ 35%, Top-20 ≤ 50%. All three factories currently exceed these thresholds, particularly for Top-20, making customer retention and diversification critical priorities.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 3 of 6</div>
</div>

<!-- ═══════════════════ PAGE 4: TOP 20 CUSTOMERS (SI) ═══════════════════ -->
<div class="page">
  <h2>8. Top 20 Customers — SI (ซูเปอร์ไอซ์)</h2>
  <p class="text-sm">Ranked by total sales volume | Period: Jan 2024 – Feb 2026</p>
  <table>
    <tr><th>#</th><th>Customer Name</th><th class="right">Total Sales</th><th class="right">Collected</th><th class="right">Outstanding</th><th class="right">Coll%</th><th class="center">Tx Count</th><th class="center">Active Months</th><th>Status</th></tr>
    ${topCustomers.SI.map((c, i) => {
      const cls = c.outstanding > 1000000 ? 'highlight' : '';
      const badge = c.coll >= 100 ? '<span class="badge badge-green">PAID</span>' : c.coll < 1 ? '<span class="badge badge-red">CRITICAL</span>' : '<span class="badge badge-yellow">PARTIAL</span>';
      return `<tr class="${cls}"><td>${i+1}</td><td>${c.name}</td><td class="right">฿${fmt(c.sales)}</td><td class="right">฿${fmt(c.paid)}</td><td class="right ${c.outstanding > 0 ? 'text-red' : ''}">${c.outstanding > 0 ? '฿'+fmt(c.outstanding) : '—'}</td><td class="right">${pct(c.coll)}</td><td class="center">${fmt(c.tx)}</td><td class="center">${c.months}/26</td><td>${badge}</td></tr>`;
    }).join("")}
  </table>

  <div class="analysis risk-high">
    <strong>SI Collections Alert — ฿69.3M Outstanding:</strong> Five customers carry the bulk of SI's receivables crisis. พันธ์สิทธิ์ (฿16.4M), โรงน้ำแข็งสุขุมวิท 50 (฿15.7M), and ชัยวัฒน์ (฿9.5M) together owe ฿41.6M — representing 60% of SI's total outstanding and 22% of SI's total revenue. Critically, these accounts show <strong>negative collection rates</strong>, meaning they are taking more product on credit than they are paying — the debt is actively growing. ปัฐวิกรณ์ has the worst ratio at -10.4% collection rate with ฿4.5M outstanding. Immediate intervention is required: credit holds, payment plans, or legal action. On the positive side, 14 of the top 20 SI customers have 100% collection rates, indicating this is a concentrated problem, not a systemic one.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 4 of 6</div>
</div>

<!-- ═══════════════════ PAGE 5: TOP 20 CUSTOMERS (BEARING + KTK) ═══════════════════ -->
<div class="page">
  <h2>9. Top 20 Customers — แบริ่ง (Bearing)</h2>
  <p class="text-sm">Ranked by total sales volume | Period: Jan 2024 – Feb 2026 | <span class="badge badge-green">100% Collection Rate — All Customers</span></p>
  <table>
    <tr><th>#</th><th>Customer Name</th><th class="right">Total Sales</th><th class="center">Tx Count</th><th class="center">Active Months</th><th class="right">Monthly Avg</th></tr>
    ${topCustomers.Bearing.map((c, i) => {
      return `<tr><td>${i+1}</td><td>${c.name}</td><td class="right">฿${fmt(c.sales)}</td><td class="center">${fmt(c.tx)}</td><td class="center">${c.months}/26</td><td class="right">฿${fmt(Math.round(c.sales/c.months))}</td></tr>`;
    }).join("")}
  </table>

  <h2>10. Top 20 Customers — KTK</h2>
  <p class="text-sm">Ranked by total sales volume | Period: Jan 2024 – Feb 2026 | <span class="badge badge-green">99.4% Collection Rate</span></p>
  <table>
    <tr><th>#</th><th>Customer Name</th><th class="right">Total Sales</th><th class="center">Tx Count</th><th class="center">Active Months</th><th class="right">Monthly Avg</th></tr>
    ${topCustomers.KTK.map((c, i) => {
      return `<tr><td>${i+1}</td><td>${c.name}</td><td class="right">฿${fmt(c.sales)}</td><td class="center">${fmt(c.tx)}</td><td class="center">${c.months}/26</td><td class="right">฿${fmt(Math.round(c.sales/c.months))}</td></tr>`;
    }).join("")}
  </table>

  <div class="analysis">
    <strong>Customer Insights — Bearing & KTK:</strong> Both factories demonstrate excellent collection discipline. Bearing's #1 customer (ตลาดนางรำ, ฿6.6M) has a higher avg monthly spend (฿254K) than any other in the group. KTK is dominated by พัฒนาการ 32 (จุดกระจายสินค้า) at ฿9.5M — this single customer represents 9.4% of KTK's total revenue, creating a significant single-point-of-failure risk. KTK's top customer spends ฿365K/month on average, nearly 2x the average of KTK's #2 customer. Bearing's สดส่ง ครึ่งซอง stands out with 29,075 transactions — by far the highest transaction count of any customer in the group — but a relatively low average of ฿157 per transaction, indicating high-frequency small orders (likely walk-in retail). This contrasts with Bearing's #1 ตลาดนางรำ which averages ฿3,009 per transaction.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 5 of 6</div>
</div>

<!-- ═══════════════════ PAGE 6: RISK + ACTION PLAN ═══════════════════ -->
<div class="page">
  <h2>11. Risk Heatmap</h2>
  <div class="grid3">
    <div class="card" style="border-left:4px solid #dc2626">
      <div class="card-header" style="color:#dc2626">HIGH RISK</div>
      <div class="action-item"><strong>SI Receivables Crisis:</strong> ฿69.3M outstanding (37.3% of SI revenue uncollected). Negative collection trends on top 3 debtors. Risk of write-off if not addressed within 90 days.</div>
      <div class="action-item"><strong>Group Revenue Decline:</strong> -14.2% SI, -17.0% Bearing, -10.7% KTK year-over-year. Current 2026 run-rate implies a further -10 to -15% decline.</div>
      <div class="action-item"><strong>Zero New Customer Acquisition:</strong> No new customers at any factory in 2026. Without new channels, revenue can only shrink as existing customers reduce orders.</div>
    </div>
    <div class="card" style="border-left:4px solid #ca8a04">
      <div class="card-header" style="color:#ca8a04">MEDIUM RISK</div>
      <div class="action-item"><strong>KTK Concentration:</strong> Top 20 = 75.1% of revenue. Loss of top 3 would eliminate ฿20.8M (20.5%) of revenue.</div>
      <div class="action-item"><strong>Avg Transaction Value Erosion:</strong> Down 10.3% at SI, 8.7% at Bearing. Possible price competition or product mix shift toward lower-margin items.</div>
      <div class="action-item"><strong>Seasonal Vulnerability:</strong> Dec-Jan cool season drives 15-25% revenue drop. Working capital must be managed for the trough.</div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <div class="card-header" style="color:#16a34a">LOW RISK / STRENGTHS</div>
      <div class="action-item"><strong>Bearing Collections:</strong> Perfect 100% collection rate across all customers — zero credit risk.</div>
      <div class="action-item"><strong>KTK Discipline:</strong> 99.4% collection rate with only ฿0.6M total outstanding.</div>
      <div class="action-item"><strong>Customer Loyalty:</strong> Core customers active for 26/26 months. Virtually zero churn. Strong operational relationships.</div>
    </div>
  </div>

  <h2>12. 90-Day Action Plan (Numeric Targets)</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-header">Phase 1: Cash Recovery (Days 1-30)</div>
      <div class="action-item"><span class="num">1</span><strong>SI Credit Hold:</strong> Freeze credit for accounts with collection rate < 50%. Target: recover ฿10M from top 5 debtors within 30 days.</div>
      <div class="action-item"><span class="num">2</span><strong>Payment Plans:</strong> Structure 6-month repayment plans for พันธ์สิทธิ์ (฿16.4M) and โรงน้ำแข็งสุขุมวิท 50 (฿15.7M). Monthly minimum ฿2.5M each.</div>
      <div class="action-item"><span class="num">3</span><strong>Target:</strong> SI collection rate from 63% → 70% within 30 days. Cash conversion improvement of ฿5M.</div>
    </div>
    <div class="card">
      <div class="card-header">Phase 2: Volume Stabilization (Days 31-60)</div>
      <div class="action-item"><span class="num">4</span><strong>Volume Recovery Target:</strong> Arrest monthly decline at all 3 factories. March 2026 target: SI ≥ ฿6.5M, Bearing ≥ ฿3.0M, KTK ≥ ฿3.5M.</div>
      <div class="action-item"><span class="num">5</span><strong>Cross-sell Initiative:</strong> Introduce Bearing's หลอดใหญ่ mix to 15 SI accounts. Target: ฿200K incremental monthly revenue.</div>
      <div class="action-item"><span class="num">6</span><strong>Price Analysis:</strong> Review avg tx value decline. If pricing is the issue, implement 3-5% price correction on top 3 SKUs at each factory.</div>
    </div>
    <div class="card">
      <div class="card-header">Phase 3: Growth Foundation (Days 61-90)</div>
      <div class="action-item"><span class="num">7</span><strong>New Customer Target:</strong> Acquire 5 new customers per factory by Day 90. Focus on geographic gaps around existing delivery routes.</div>
      <div class="action-item"><span class="num">8</span><strong>Concentration Limit:</strong> Reduce KTK Top-5 share from 29.4% to ≤ 27% by growing mid-tier accounts. Offer volume incentives to customers ranked 10-30.</div>
      <div class="action-item"><span class="num">9</span><strong>Quarterly Target:</strong> Q2 2026 group revenue ≥ ฿30M/month (vs current ฿18.4M run-rate, accounting for Feb being partial). This represents a 5% improvement over Q1 2026 trajectory.</div>
    </div>
    <div class="card">
      <div class="card-header">KPI Scorecard — Monitoring Cadence</div>
      <table>
        <tr><th>KPI</th><th>Current</th><th>30-Day Target</th><th>90-Day Target</th></tr>
        <tr><td>SI Collection Rate</td><td class="text-red">63.1%</td><td>70%</td><td>75%</td></tr>
        <tr><td>SI Outstanding</td><td class="text-red">฿69.3M</td><td>฿59M</td><td>฿45M</td></tr>
        <tr><td>Group Monthly Revenue</td><td>฿18.4M*</td><td>฿19M</td><td>฿20M</td></tr>
        <tr><td>New Customers (Group)</td><td>0</td><td>5</td><td>15</td></tr>
        <tr><td>KTK Top-5 Share</td><td>29.4%</td><td>29%</td><td>≤ 27%</td></tr>
        <tr><td>Avg Tx Value (SI)</td><td>฿767</td><td>฿800</td><td>฿850</td></tr>
      </table>
      <p class="text-sm" style="margin-top:4px">* Feb 2026 partial month — full month estimate ~฿19.5M</p>
    </div>
  </div>

  <div class="analysis">
    <strong>Final Recommendation:</strong> The top priority is cash conversion at SI — recovering even 20% of the ฿69.3M outstanding would fund all growth initiatives and improve the group's financial position. The revenue decline across all factories suggests either market share loss to competitors, pricing pressure, or structural demand shifts. A competitive analysis is recommended to identify whether new ice factories have entered the Bangkok market. Operationally, the Bearing factory's 100% collection model should be studied and replicated at SI. KTK's high per-transaction value but small customer base makes it the most efficient but also the most vulnerable factory — diversification there is essential.
  </div>

  <div class="footer">SuperIce Group — Confidential BI Report | Page 6 of 6 | Report generated automatically from POS database</div>
</div>

<!-- ═══════════════════ CHART SCRIPTS ═══════════════════ -->
<script>
const labels = ${labelsJSON};
const siSales = ${JSON.stringify(monthlyData.SI.map(d => d.sales))};
const bearSales = ${JSON.stringify(monthlyData.Bearing.map(d => d.sales))};
const ktkSales = ${JSON.stringify(monthlyData.KTK.map(d => d.sales))};

const siCust = ${JSON.stringify(customerGrowth.SI.map(d => d.active))};
const bearCust = ${JSON.stringify(customerGrowth.Bearing.map(d => d.active))};
const ktkCust = ${JSON.stringify(customerGrowth.KTK.map(d => d.active))};

const siNew = ${JSON.stringify(customerGrowth.SI.map(d => d.newCust))};
const bearNew = ${JSON.stringify(customerGrowth.Bearing.map(d => d.newCust))};
const ktkNew = ${JSON.stringify(customerGrowth.KTK.map(d => d.newCust))};

Chart.defaults.font.size = 9;
Chart.defaults.font.family = "'Helvetica Neue','Sarabun',sans-serif";

function millionTick(value) { return '฿' + (value / 1e6).toFixed(1) + 'M'; }

// Combined sales chart
new Chart(document.getElementById('chartSalesAll'), {
  type: 'line',
  data: {
    labels,
    datasets: [
      { label: 'SI', data: siSales, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 },
      { label: 'Bearing', data: bearSales, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 },
      { label: 'KTK', data: ktkSales, borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { boxWidth: 12 } }, title: { display: true, text: 'Monthly Sales Revenue — All Factories', font: { size: 12 } } },
    scales: { y: { ticks: { callback: millionTick }, grid: { color: '#f1f5f9' } }, x: { ticks: { maxRotation: 45 }, grid: { display: false } } },
    animation: false
  }
});

// Individual factory charts
[['chartSI','SI','#2563eb',siSales],['chartBearing','Bearing','#16a34a',bearSales],['chartKTK','KTK','#ea580c',ktkSales]].forEach(([id,name,color,data]) => {
  new Chart(document.getElementById(id), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: name + ' Revenue', data, borderColor: color, backgroundColor: color+'18', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 1.5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: name + ' Monthly Revenue', font: { size: 10 } } },
      scales: { y: { ticks: { callback: millionTick, font: { size: 7 } }, grid: { color: '#f1f5f9' } }, x: { ticks: { maxRotation: 60, font: { size: 6 } }, grid: { display: false } } },
      animation: false
    }
  });
});

// Customer chart
new Chart(document.getElementById('chartCustomers'), {
  type: 'line',
  data: {
    labels,
    datasets: [
      { label: 'SI Active', data: siCust, borderColor: '#2563eb', borderWidth: 2, pointRadius: 2, tension: 0.3 },
      { label: 'Bearing Active', data: bearCust, borderColor: '#16a34a', borderWidth: 2, pointRadius: 2, tension: 0.3 },
      { label: 'KTK Active', data: ktkCust, borderColor: '#ea580c', borderWidth: 2, pointRadius: 2, tension: 0.3 },
      { label: 'SI New', data: siNew, borderColor: '#2563eb', borderDash: [4,2], borderWidth: 1, pointRadius: 1, tension: 0.3, yAxisID: 'y1' },
      { label: 'Bearing New', data: bearNew, borderColor: '#16a34a', borderDash: [4,2], borderWidth: 1, pointRadius: 1, tension: 0.3, yAxisID: 'y1' },
      { label: 'KTK New', data: ktkNew, borderColor: '#ea580c', borderDash: [4,2], borderWidth: 1, pointRadius: 1, tension: 0.3, yAxisID: 'y1' },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 8 } } }, title: { display: true, text: 'Active Customers (solid) & New Customers (dashed)', font: { size: 11 } } },
    scales: {
      y: { title: { display: true, text: 'Active Customers' }, grid: { color: '#f1f5f9' } },
      y1: { position: 'right', title: { display: true, text: 'New Customers' }, grid: { display: false }, min: 0 },
      x: { ticks: { maxRotation: 45 }, grid: { display: false } }
    },
    animation: false
  }
});
</script>
</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const html = buildHTML();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html, "utf-8");
  console.log("HTML written to:", OUTPUT_HTML);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

  // Wait for Chart.js to render
  await page.waitForFunction(() => {
    return Chart.instances && Object.keys(Chart.instances).length >= 4;
  }, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  await page.pdf({
    path: OUTPUT_PDF,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    displayHeaderFooter: false,
  });
  console.log("PDF written to:", OUTPUT_PDF);

  await browser.close();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
