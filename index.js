const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const PromisePool = require("@supercharge/promise-pool");
const url = require("url");
const { parse } = require('json2csv');
const fs = require("fs-extra")
const { format } = require("date-fns")

const LIMIT = 100;

(async () => {
    const browser = await puppeteer.launch({
        // only support non headless mode
        headless: false,
    });

    try {
        const searchUrl = "https://www.tokopedia.com/p/handphone-tablet/handphone";

        const context = browser.defaultBrowserContext();
        context.overridePermissions("https://www.tokopedia.com", [
            "notifications",
        ]);
        const tab = await context.newPage();

        // use set to prevent duplicate
        let links = new Set()
        let page = 1;
        do {
            await tab.goto(`${searchUrl}?page=${page++}`, {
                waitUntil: "networkidle2",
                timeout: 1 * 60 * 1000,
            });

            await autoScroll(tab);

            const body = await tab.evaluate(() => document.documentElement.outerHTML);

            const $ = cheerio.load(body, { xmlMode: true });

            const mainSection = $("[data-testid=lstCL2ProductList]").get(0)

            if (!mainSection) {
                break;
            }

            const elements = $(mainSection).find("[data-testid=lnkProductContainer]")

            for (let i = 0; i < elements.length; i++) {
                const element = elements[i];

                let link = element.attribs.href;

                const ads = !link.startsWith("https://www.tokopedia.com/");
                if (ads) {
                    continue;
                }

                link = `${url.parse(link).protocol}//${url.parse(link).hostname}${url.parse(link).pathname}`;

                links.add(link);
            }
        } while (links.size < LIMIT);

        await tab.close();

        links = Array.from(links)
        links = links.slice(0, LIMIT);

        const products = []
        // for now, only support one product concurrently
        await PromisePool.for(links)
            .withConcurrency(1)
            .process(async (link) => {
                const context = browser.defaultBrowserContext();
                const detailTab = await context.newPage();

                try {
                    await detailTab.goto(link, {
                        waitUntil: "networkidle2",
                        timeout: 1 * 60 * 1000,
                    });

                    const body = await detailTab.evaluate(
                        () => document.documentElement.outerHTML
                    );

                    // this approach can crawl multiple link concurrently, doesn't work anymore
                    // let startIndex = body.indexOf(`window.__cache=`);
                    // if (startIndex > -1) {
                    //     startIndex += 15;
                    // }

                    // const endIndex = body.indexOf(`</script>`, startIndex);

                    // let jsonString = body.substring(startIndex, endIndex);
                    // const substrings = jsonString.split("};");

                    // if (substrings.length > 0) {
                    //     const data = JSON.parse(substrings[0] + "}");

                    //     console.log(data)

                    //     let productName = "";
                    //     let description = "";
                    //     let imageLink = "";
                    //     let price = 0;
                    //     let rating = 0;
                    //     let storeName = "";

                    //     Object.keys(data).forEach((key) => {
                    //         const value = data[key];

                    //         console.log(value)

                    //         // 1. Name of Product
                    //         // 2. Description
                    //         // 3. Image Link
                    //         // 4. Price
                    //         // 5. Rating (out of 5 stars)
                    //         // 6. Name of store or merchant
                    //         if (value.price && value.stock) {
                    //             productName = value.name;

                    //             const priceObject = data[value.price.id];
                    //             price = priceObject.value;
                    //         }
                    //     });
                    // }

                    const $ = cheerio.load(body, { xmlMode: true });

                    let productName = $("[data-testid=lblPDPDetailProductName]").get(0)
                    productName = $(productName).html().replace(/\s{2,}/g, ' ').trim()

                    let description = $("[data-testid=lblPDPDescriptionProduk]").get(0)
                    description = $(description).html().replace(/\s{2,}/g, ' ').trim()

                    let imageLink = $("[data-testid=PDPImageMain]").get(0)
                    imageLink = $(imageLink).find("img").get(0).attribs.src

                    let price = $("[data-testid=lblPDPDetailProductPrice]").get(0)
                    price = price.children[0].data

                    let rating = $("[itemprop=ratingValue]").get(0).attribs.content

                    let storeName = $("[data-testid=llbPDPFooterShopName]").get(0)
                    storeName = $(storeName).find("h2").get(0)
                    storeName = storeName.children[0].data

                    products.push({
                        product_name: productName,
                        product_description: description,
                        product_image: imageLink,
                        product_price: price,
                        product_rating: rating,
                        store_name: storeName,
                    })

                    await detailTab.close();
                } catch (error) {
                    console.error("Error crawling product detail", error.message)
                } finally {
                    await detailTab.close();
                }
            });


        const fields = [
            'product_name',
            'product_description',
            'product_image',
            'product_price',
            'product_rating',
            'store_name',
        ];
        const opts = { fields };

        try {
            const csv = parse(products, opts);

            await fs.outputFile(`./${format(new Date(), "yyyyMMddHHmmss")}.csv`, csv, "utf8")
        } catch (err) {
            console.error("Error when parsing csv", err);
        }
    } catch (error) {
        console.error("Unhandler error", error.message);
    } finally {
        await browser.close();
    }
})();

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 100;
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}