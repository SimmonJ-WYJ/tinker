// 仅从内存中的 PDF 读取每个物理页的文字；不创建 PDFView、不接收 URL 或密码。
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#include <arpa/inet.h>
#include <stdio.h>

int tinker_pdf_pages(const uint8_t *bytes, size_t length, size_t pageLimit, size_t textLimit) {
    @autoreleasepool {
        @try {
            NSData *input = [NSData dataWithBytesNoCopy:(void *)bytes length:length freeWhenDone:NO];
            PDFDocument *document = [[PDFDocument alloc] initWithData:input];
            if (!document) return 1;
            if (document.isEncrypted || document.isLocked) return 2;
            NSUInteger count = document.pageCount;
            if (count == 0) return 1;
            if (count > pageLimit) return 3;
            size_t remaining = textLimit;
            for (NSUInteger index = 0; index < count; ++index) {
                @autoreleasepool {
                    PDFPage *page = [document pageAtIndex:index];
                    if (!page) return 1;
                    NSString *text = page.string ?: @"";
                    NSUInteger size = [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
                    if (size > remaining) return 3;
                    NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
                    if (!data || data.length != size) return 1;
                    uint32_t prefix = htonl((uint32_t)size);
                    if (fwrite(&prefix, sizeof(prefix), 1, stdout) != 1 ||
                        (size && fwrite(data.bytes, 1, size, stdout) != size)) return 4;
                    remaining -= size;
                }
            }
            return fflush(stdout) == 0 ? 0 : 4;
        } @catch (NSException *exception) {
            return 1;
        }
    }
}
