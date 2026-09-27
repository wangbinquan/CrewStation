#include <stdio.h>
#include <unistd.h>

int main(void) {
    printf("worker:%ld\n", (long)getuid());
    return getuid() == 10001 ? 0 : 1;
}
