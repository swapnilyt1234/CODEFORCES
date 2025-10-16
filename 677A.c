#include <stdio.h>

int main(){
    int num,hf,hp,width,i,sum=0;

    scanf("%d %d", &num, &hf);

    for(i=0;i<num;i++){
        hp = 0;
        scanf("%d", &hp);

        if(hp<=hf){
            width = 1;
        }
        else{
            width = 2;
        }

        sum += width;


    }

    printf("%d", sum);
    return 0;
}
