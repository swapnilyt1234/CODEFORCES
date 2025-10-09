#include <stdio.h>

int main() {
    // Your code goes here
    int a,n,b,c,i,count=0;
    
    scanf("%d", &n);

for(i=0;i<n;i++){
    a=0,b=0,c=0;
    scanf("%d", &a);
    scanf("%d", &b);
    scanf("%d", &c);

    if(a==1 && b==1 || b==1 && c==1 || c==1 && a==1) {
        count++;
    }
}

printf("%d", count);
    return 0;
}
